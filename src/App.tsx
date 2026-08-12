/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Project, Yard, Asset, BinAsset, generateProjectId } from './types';
import { DashboardView } from './components/DashboardView';
import { SitePlannerView } from './components/SitePlannerView';
import { LandingBackground } from './components/LandingBackground';
import { CableEstimatorView } from './components/CableEstimatorView';
import { BinSpecsView } from './components/BinSpecsView';
import { generateUnifiedPDF } from './utils/pdfGenerator';
import { LayoutDashboard, Map as MapIcon, Download, Loader2, Plus, FolderOpen, Cloud, RefreshCw, AlertTriangle, Play, ChevronRight, FileCode, LogOut, Search, X, Github, GitBranch, Home, FileText, Compass, Copy, Check, Pencil } from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  listProjectsFromDrive,
  loadProjectFromDrive,
  DriveFile,
  logout,
  saveProjectToDrive,
} from './utils/googleDrive';
const DEFAULT_PROJECT: Project = {
  id: 'proj_default_site_plan',
  name: 'New Site Project',
  customer: {
    name: '',
    phone: '',
    email: '',
    location: '',
  },
  date: new Date().toLocaleDateString(),
  activeYardId: 1001,
  yards: [
    {
      id: 1001,
      name: 'Main Yard',
      bins: [],
    },
  ],
  notes: '',
};

// Helper to synchronize cable lengths of grain bins sharing the same eaveHeight and totalHeight
function syncProjectCables(next: Project, prev: Project): Project {
  // Map of previous bins for lookup
  const prevBinsMap = new Map<number, BinAsset>();
  for (const y of prev.yards) {
    for (const b of y.bins) {
      if (b.type === 'bin') {
        prevBinsMap.set(b.id, b);
      }
    }
  }

  // Get all bins in next state
  const nextBins: BinAsset[] = [];
  for (const y of next.yards) {
    for (const b of y.bins) {
      if (b.type === 'bin') {
        nextBins.push(b);
      }
    }
  }

  // Group next bins by specifications: eaveHeight_totalHeight
  const groups = new Map<string, BinAsset[]>();
  for (const b of nextBins) {
    const key = `${b.eaveHeight}_${b.totalHeight}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(b);
  }

  const syncValues = new Map<string, { centerCable: string; radiusCable: string }>();

  for (const [key, bins] of groups.entries()) {
    let activeTruthBin: BinAsset | null = null;

    // 1. Check if any bin in this group had its cables updated to a non-empty value
    for (const b of bins) {
      const prevBin = prevBinsMap.get(b.id);
      if (prevBin) {
        const cablesChanged = prevBin.centerCable !== b.centerCable || prevBin.radiusCable !== b.radiusCable;
        const hasCables = b.centerCable || b.radiusCable;
        if (cablesChanged && hasCables) {
          activeTruthBin = b;
          break;
        }
      }
    }

    // 2. If no direct non-empty cable update, find an existing bin in this group with cables
    if (!activeTruthBin) {
      activeTruthBin = bins.find(b => b.centerCable || b.radiusCable) || null;
    }

    if (activeTruthBin) {
      syncValues.set(key, {
        centerCable: activeTruthBin.centerCable || '',
        radiusCable: activeTruthBin.radiusCable || '',
      });
    }
  }

  // Map the new project with synchronized cable lengths for matched bins
  return {
    ...next,
    yards: next.yards.map(y => ({
      ...y,
      bins: y.bins.map(b => {
        if (b.type === 'bin') {
          const key = `${b.eaveHeight}_${b.totalHeight}`;
          const syncVal = syncValues.get(key);
          if (syncVal) {
            return {
              ...b,
              centerCable: syncVal.centerCable,
              radiusCable: syncVal.radiusCable,
            };
          }
        }
        return b;
      }),
    })),
  };
}

export default function App() {
  // Load saved project from localStorage upon app initialization
  const [project, setProject] = useState<Project>(() => {
    try {
      const saved = localStorage.getItem('grainlink_project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.yards) && typeof parsed.name === 'string') {
          if (!parsed.id) {
            parsed.id = generateProjectId();
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to parse saved project state from localStorage:', e);
    }
    return { ...DEFAULT_PROJECT, id: generateProjectId() };
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'planner' | 'estimator' | 'binSpecs'>('dashboard');
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [activeBinId, setActiveBinId] = useState<number | null>(null);
  const [includeAssetDirectory, setIncludeAssetDirectory] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [showCustomerModal, setShowCustomerModal] = useState<boolean>(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState<boolean>(false);

  const handleCopyProjectId = () => {
    if (!project.id) return;
    navigator.clipboard.writeText(project.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Undo history stack state
  const [history, setHistory] = useState<Project[]>([]);

  const updateProjectWithHistory = (updater: Project | ((prev: Project) => Project)) => {
    setProject((prev) => {
      let next = typeof updater === 'function' ? updater(prev) : updater;
      next = syncProjectCables(next, prev);
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        setHistory((prevHistory) => {
          const updated = [...prevHistory, prev];
          if (updated.length > 50) {
            updated.shift();
          }
          return updated;
        });
      }
      return next;
    });
  };

  const handleUndo = () => {
    setHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const copy = [...prevHistory];
      const previousState = copy.pop();
      if (previousState) {
        setProject(previousState);
      }
      return copy;
    });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // PDF generation overlay loading state
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  // Landing page states
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [landingUser, setLandingUser] = useState<any>(null);
  const [landingToken, setLandingToken] = useState<string | null>(null);
  const [landingDriveFiles, setLandingDriveFiles] = useState<DriveFile[]>([]);
  const [landingSearchQuery, setLandingSearchQuery] = useState<string>('');
  const [isLoadingLandingDrive, setIsLoadingLandingDrive] = useState(false);
  const [landingDriveError, setLandingDriveError] = useState<string | null>(null);

  // Navigation history & URL hash synchronization for browser back/forward support
  const getHashForNav = (isLanding: boolean, tab: string) => {
    if (isLanding) return '#landing';
    if (tab === 'planner') return '#planner';
    if (tab === 'estimator') return '#estimator';
    if (tab === 'binSpecs') return '#binSpecs';
    return '#dashboard';
  };

  const getNavFromLocation = (): { showLanding: boolean; activeTab: 'dashboard' | 'planner' | 'estimator' | 'binSpecs' } => {
    try {
      const hash = window.location.hash ? window.location.hash.replace('#', '').toLowerCase() : '';
      if (hash === 'dashboard') return { showLanding: false, activeTab: 'dashboard' };
      if (hash === 'planner' || hash === 'site-planner') return { showLanding: false, activeTab: 'planner' };
      if (hash === 'estimator' || hash === 'cable-estimator') return { showLanding: false, activeTab: 'estimator' };
      if (hash === 'binspecs' || hash === 'bin-specs') return { showLanding: false, activeTab: 'binSpecs' };
      if (hash === 'landing' || hash === 'home') return { showLanding: true, activeTab: 'dashboard' };

      if (window.history && window.history.state && typeof window.history.state.showLanding === 'boolean') {
        return {
          showLanding: window.history.state.showLanding,
          activeTab: window.history.state.activeTab || 'dashboard',
        };
      }
    } catch (e) {
      console.warn("Location state reading skipped:", e);
    }

    return { showLanding: true, activeTab: 'dashboard' };
  };

  const navigateTo = useCallback((nextShowLanding: boolean, nextTab?: 'dashboard' | 'planner' | 'estimator' | 'binSpecs') => {
    setShowLanding(nextShowLanding);
    const targetTab = nextTab || activeTab;
    if (nextTab) {
      setActiveTab(nextTab);
    }

    try {
      const hash = getHashForNav(nextShowLanding, targetTab);
      const targetState = { showLanding: nextShowLanding, activeTab: targetTab };

      const currentHash = window.location.hash;
      const currentState = window.history ? window.history.state : null;

      if (
        currentHash !== hash ||
        !currentState ||
        currentState.showLanding !== nextShowLanding ||
        currentState.activeTab !== targetTab
      ) {
        if (window.history && typeof window.history.pushState === 'function') {
          window.history.pushState(targetState, '', hash);
        }
      }
    } catch (e) {
      console.warn("pushState unavailable:", e);
    }
  }, [activeTab]);

  // Synchronize browser history and handle browser Back / Forward (popstate)
  useEffect(() => {
    try {
      const initialNav = getNavFromLocation();
      setShowLanding(initialNav.showLanding);
      setActiveTab(initialNav.activeTab);

      const initialHash = getHashForNav(initialNav.showLanding, initialNav.activeTab);
      if (window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(
          { showLanding: initialNav.showLanding, activeTab: initialNav.activeTab },
          '',
          initialHash
        );
      }
    } catch (e) {
      console.warn("replaceState unavailable on mount:", e);
    }

    const handlePopState = (e: PopStateEvent) => {
      try {
        let nav: { showLanding: boolean; activeTab: 'dashboard' | 'planner' | 'estimator' | 'binSpecs' };
        if (e && e.state && typeof e.state.showLanding === 'boolean') {
          nav = {
            showLanding: e.state.showLanding,
            activeTab: e.state.activeTab || 'dashboard',
          };
        } else {
          nav = getNavFromLocation();
        }
        setShowLanding(nav.showLanding);
        setActiveTab(nav.activeTab);
      } catch (err) {
        console.warn("popstate handler fallback:", err);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Auto-save states
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState<Date | null>(null);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);

  // Git synchronization states
  const [gitStatus, setGitStatus] = useState<{ hasChanges: boolean; changes: string[] } | null>(null);
  const [isPushingToGit, setIsPushingToGit] = useState(false);
  const [gitPushMessage, setGitPushMessage] = useState<string>('Sync changes from AI Studio');
  const [gitResult, setGitResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showGitModal, setShowGitModal] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  // Check if current user is developer
  useEffect(() => {
    // Check url param
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === 'true') {
      localStorage.setItem('grainlink_dev_mode', 'true');
    } else if (params.get('dev') === 'false') {
      localStorage.removeItem('grainlink_dev_mode');
    }

    const isLocalDev = (import.meta as any).env?.DEV || 
                       window.location.hostname.includes('ais-dev') || 
                       window.location.hostname.includes('localhost') || 
                       window.location.hostname.includes('127.0.0.1');

    setIsDevMode(isLocalDev);
  }, [landingUser]);

  // Fetch git status
  const checkGitStatus = async () => {
    try {
      const res = await fetch("/api/github/status");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(text.slice(0, 100) || "Invalid JSON response");
      }
      if (data && data.success) {
        setGitStatus({
          hasChanges: data.hasChanges,
          changes: data.changes,
        });
      }
    } catch (err) {
      console.warn("Error fetching git status (rate limit or connection issue):", err);
    }
  };

  useEffect(() => {
    checkGitStatus();
    // Check periodically every 15 seconds
    const interval = setInterval(checkGitStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleGitPush = async (commitMessage: string) => {
    setIsPushingToGit(true);
    setGitResult(null);
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitMessage }),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(text.slice(0, 100) || "Invalid JSON response");
      }
      if (data && data.success) {
        setGitResult({ success: true, message: "Successfully pushed to GitHub! Your changes will be live shortly." });
        checkGitStatus(); // Refresh status
      } else {
        const details = [];
        if (data?.error) details.push(data.error);
        if (data?.stderr) details.push(`Stderr: ${data.stderr}`);
        if (data?.stdout) details.push(`Stdout: ${data.stdout}`);
        setGitResult({ 
          success: false, 
          message: `Failed to push. Detailed log:\n${details.join("\n\n") || "Unknown error"}` 
        });
      }
    } catch (err: any) {
      setGitResult({ success: false, message: `Network/API error: ${err.message || err}` });
    } finally {
      setIsPushingToGit(false);
    }
  };

  const landingFileInputRef = useRef<HTMLInputElement>(null);

  // Refs for tracking the latest project and auto-saving state to avoid unnecessary interval rebuilds
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const isAutoSavingRef = useRef(false);
  useEffect(() => {
    isAutoSavingRef.current = isAutoSaving;
  }, [isAutoSaving]);

  // Global Auto-save effect: Runs every 1 minute if Google Drive is authorized and we are not on the landing page
  useEffect(() => {
    if (!landingToken || showLanding) {
      return;
    }

    const intervalId = setInterval(async () => {
      if (isAutoSavingRef.current) return;

      setIsAutoSaving(true);
      setAutoSaveError(null);
      try {
        const savedFileId = await saveProjectToDrive(landingToken, projectRef.current);
        if (savedFileId && projectRef.current.driveFileId !== savedFileId) {
          updateProjectWithHistory((prev) => ({ ...prev, driveFileId: savedFileId }));
        }
        setLastAutoSaved(new Date());
      } catch (err: any) {
        console.error('Auto-save to Google Drive failed:', err);
        setAutoSaveError(err.message || 'Auto-save failed');
        if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
          logout().catch(console.error);
          setLandingToken(null);
          setLandingUser(null);
        }
      } finally {
        setIsAutoSaving(false);
      }
    }, 60000); // 1 minute

    return () => clearInterval(intervalId);
  }, [landingToken, showLanding]);

  // Save current project state to localStorage whenever the project object changes
  useEffect(() => {
    try {
      localStorage.setItem('grainlink_project', JSON.stringify(project));
      // Update saved draft status
      setHasSavedDraft(true);
      setLocalSaveError(null);
    } catch (e: any) {
      console.error('Failed to save project state to localStorage:', e);
      setLocalSaveError(
        e?.name === 'QuotaExceededError'
          ? 'Browser storage is full'
          : 'Not saving to this browser'
      );
    }
  }, [project]);

  // Check if saved draft actually exists on init
  useEffect(() => {
    try {
      const saved = localStorage.getItem('grainlink_project');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.yards)) {
          setHasSavedDraft(true);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Google Drive Auth Listener for Landing Page
  useEffect(() => {
    const unsubscribe = initAuth(
      (u, token) => {
        setLandingUser(u);
        setLandingToken(token);
        fetchLandingDriveFiles(token);
      },
      () => {
        setLandingUser(null);
        setLandingToken(null);
        setLandingDriveFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchLandingDriveFiles = async (tokenToUse?: string | null) => {
    const tok = tokenToUse || landingToken;
    if (!tok) return;
    setIsLoadingLandingDrive(true);
    setLandingDriveError(null);
    try {
      const files = await listProjectsFromDrive(tok);
      setLandingDriveFiles(files);
    } catch (err: any) {
      console.error(err);
      setLandingDriveError(err.message || 'Failed to list designs from Google Drive');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setLandingToken(null);
        setLandingUser(null);
      }
    } finally {
      setIsLoadingLandingDrive(false);
    }
  };

  const handleConnectLandingDrive = async () => {
    setLandingDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setLandingUser(result.user);
        setLandingToken(result.accessToken);
        fetchLandingDriveFiles(result.accessToken);
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.message?.includes('popup-closed-by-user')) {
        setLandingDriveError('The sign-in window was closed. Please try again to connect Google Drive.');
      } else {
        setLandingDriveError(err.message || 'Google Drive connection failed');
      }
    }
  };

  const handleDisconnectLandingDrive = async () => {
    setLandingDriveError(null);
    try {
      await logout();
      setLandingUser(null);
      setLandingToken(null);
      setLandingDriveFiles([]);
    } catch (err: any) {
      setLandingDriveError(err.message || 'Sign out failed');
    }
  };

  const handleLoadFromLandingDrive = async (fileId: string, fileName: string) => {
    if (!landingToken) return;
    setIsLoadingLandingDrive(true);
    setLandingDriveError(null);
    try {
      const loaded = await loadProjectFromDrive(landingToken, fileId);
      if (!loaded.id) {
        loaded.id = generateProjectId();
      }
      loaded.driveFileId = fileId;
      setProject(loaded);
      navigateTo(false, 'planner');
    } catch (err: any) {
      setLandingDriveError(err.message || 'Failed to load design');
      if (err.message?.includes('expired') || err.message?.includes('re-authorize') || err.message?.includes('401') || err.status === 401) {
        logout().catch(console.error);
        setLandingToken(null);
        setLandingUser(null);
      }
    } finally {
      setIsLoadingLandingDrive(false);
    }
  };

  const handleLoadProjectJSONLanding = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        let loadedProject: Project;

        if (Array.isArray(imported)) {
          const mainYardId = Date.now();
          loadedProject = {
            id: generateProjectId(),
            name: 'Imported Legacy Layout',
            customer: { name: 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported }],
          };
        } else if (imported && typeof imported === 'object' && imported.bins && !imported.yards) {
          const mainYardId = Date.now();
          loadedProject = {
            id: imported.id || generateProjectId(),
            driveFileId: imported.driveFileId,
            name: imported.name || 'Imported Legacy Layout',
            customer: { name: imported.client || 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported.bins }],
          };
        } else if (imported && typeof imported === 'object' && Array.isArray(imported.yards)) {
          loadedProject = {
            id: imported.id || generateProjectId(),
            driveFileId: imported.driveFileId,
            name: imported.name || 'Miller Site Layout',
            customer: imported.customer || { name: 'John Miller', phone: '555-0199' },
            date: imported.date || new Date().toLocaleDateString(),
            activeYardId: imported.activeYardId || (imported.yards?.[0]?.id || null),
            yards: imported.yards || [],
          };
        } else {
          alert('Invalid project format. Make sure the JSON file is a valid GrainLink layout.');
          return;
        }

        // Normalize loadedProject bins and types to prevent crashes/unsupported fields
        loadedProject.yards = loadedProject.yards.map(yard => ({
          ...yard,
          bins: (yard.bins || []).map((bin: any) => {
            let type = bin.type;
            if (!type) {
              if (bin.diameter && (bin.rings || bin.centerCable || bin.radiusCable || bin.name)) {
                type = 'bin';
              } else {
                type = 'bin';
              }
            }
            if (type === 'bin') {
              return {
                id: bin.id || Date.now() + Math.random(),
                type: 'bin',
                name: bin.name || 'Unnamed Bin',
                notes: bin.notes || '',
                x: Number(bin.x) || 0,
                y: Number(bin.y) || 0,
                diameter: String(bin.diameter || '36'),
                rings: String(bin.rings || '10'),
                eaveHeight: String(bin.eaveHeight || ''),
                totalHeight: String(bin.totalHeight || ''),
                floorThick: String(bin.floorThick || '0'),
                centerCable: String(bin.centerCable || ''),
                radiusCable: String(bin.radiusCable || ''),
                measurements: Array.isArray(bin.measurements) ? bin.measurements : []
              } as any;
            } else if (type === 'zone') {
              return {
                id: bin.id || Date.now() + Math.random(),
                type: 'zone',
                name: bin.name || 'Zone',
                notes: bin.notes || '',
                x: Number(bin.x) || 0,
                y: Number(bin.y) || 0,
                width: String(bin.width || '100'),
                height: String(bin.height || '100')
              } as any;
            } else {
              return {
                id: bin.id || Date.now() + Math.random(),
                type: type,
                name: bin.name || '',
                notes: bin.notes || '',
                x: Number(bin.x) || 0,
                y: Number(bin.y) || 0,
                diameter: String(bin.diameter || '5')
              } as any;
            }
          })
        }));

        if (loadedProject.yards.length === 0) {
          const defId = Date.now();
          loadedProject.yards.push({ id: defId, name: 'Home Yard', bins: [] });
          loadedProject.activeYardId = defId;
        }

        setProject(loadedProject);
        navigateTo(false, 'planner');
      } catch (err) {
        alert('Failed to read the JSON file. Ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  };

  // Handle locating an asset from inventory table
  const handleLocateAsset = (assetId: number) => {
    // Find asset across all yards
    for (const y of project.yards) {
      const b = y.bins.find((bin) => bin.id === assetId);
      if (b) {
        updateProjectWithHistory((prev) => ({ ...prev, activeYardId: y.id }));
        setSelectedAssetId(assetId);
        navigateTo(false, 'planner');
        break;
      }
    }
  };

  const handleSelectBinInEstimator = (binId: number) => {
    setActiveBinId(binId);
    navigateTo(false, 'estimator');
  };

  const triggerPDFExport = () => {
    generateUnifiedPDF(project, { setLoading, setLoadingText }, { includeAssetDirectory });
  };

  return (
    <div className="flex h-screen w-full select-none overflow-hidden bg-ink text-ink font-sans">
      {/* Immersive Landing Page View */}
      {showLanding ? (
        <div className="fixed inset-0 z-50 overflow-hidden text-ink flex flex-col items-center justify-center bg-paper">
          {/* Background Illustration Layer (z-0) */}
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
            <LandingBackground />
          </div>

          {/* Soft Readability Vignette (z-10) */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(247,246,242,0.75)_0%,rgba(247,246,242,0.2)_55%,rgba(247,246,242,0)_80%)] z-10 pointer-events-none" />
          
          {/* Main Content Area (z-20) */}
          <div className="relative z-20 w-full h-full overflow-y-auto flex flex-col items-center justify-center px-6 py-12">
            <div className="max-w-4xl w-full flex flex-col items-center animate-fade-in">
            
            {/* Logo / Brand Accent */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-4xl font-black text-ink tracking-tight font-display">
                Grain<span className="text-gold">Link</span>
              </span>
            </div>

            <h1 className="text-3xl md:text-5xl font-light tracking-[0.25em] text-center text-ink mb-12 uppercase font-display">
              Site Planner
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
              
              {/* Left Box: New Site / Resume */}
              <div className="bg-surface/90 border border-line/90 rounded-3xl p-8 flex flex-col justify-between hover:border-line transition-all shadow-xl">
                <div className="space-y-4">
                  <div className="inline-flex p-3 bg-gold-light text-gold rounded-2xl border border-gold/30">
                    <Plus size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-ink">Start Planning</h2>
                  <p className="text-xs text-ink-soft leading-relaxed">
                    Create a brand new site plan layout or resume your session. You can also import any local JSON backup file to instantly load it.
                  </p>
                </div>

                <div className="space-y-3 mt-8">
                  <button
                    onClick={() => {
                      setProject({
                        ...DEFAULT_PROJECT,
                        id: generateProjectId(),
                        driveFileId: undefined,
                      });
                      navigateTo(false, 'planner');
                    }}
                    className="w-full py-3.5 bg-gold hover:bg-gold-hover text-ink font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-gold/10"
                  >
                    <Plus size={14} strokeWidth={2.5} />
                    Create New Site Plan
                  </button>

                  {hasSavedDraft && (
                    <button
                      onClick={() => {
                        navigateTo(false, 'planner');
                      }}
                      className="w-full py-3.5 bg-surface hover:bg-paper text-ink border border-line font-bold text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer animate-pulse"
                    >
                      <Play size={12} className="text-gold fill-gold" />
                      Resume Active Session
                    </button>
                  )}

                  <button
                    onClick={() => landingFileInputRef.current?.click()}
                    className="w-full py-3.5 bg-surface hover:bg-surface text-ink-soft border border-line/90 font-bold text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <FileCode size={12} className="text-ink-soft" />
                    Import JSON File
                  </button>
                  <input
                    type="file"
                    ref={landingFileInputRef}
                    className="hidden"
                    accept=".json"
                    onChange={handleLoadProjectJSONLanding}
                  />
                </div>
              </div>

              {/* Right Box: Google Drive Cloud Sync */}
              <div className="bg-surface/90 border border-line/90 rounded-3xl p-8 flex flex-col hover:border-line transition-all shadow-xl">
                <div className="space-y-4">
                  <div className="inline-flex p-3 bg-gold-light text-gold rounded-2xl border border-gold/30">
                    <Cloud size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-ink">Google Drive Sync</h2>
                  <p className="text-xs text-ink-soft leading-relaxed">
                    Sign in to connect with Google Drive. Pull, sync, and load central layout designs directly from your cloud storage.
                  </p>
                </div>

                <div className="flex-1 flex flex-col justify-center space-y-3 min-h-[180px]">
                  {landingDriveError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-500" />
                      <span className="break-all">{landingDriveError}</span>
                    </div>
                  )}

                  {!landingToken ? (
                    <button
                      onClick={handleConnectLandingDrive}
                      className="w-full flex items-center justify-center gap-3 bg-surface hover:bg-paper text-ink font-bold rounded-xl text-xs py-3.5 px-4 shadow-md transition-all cursor-pointer"
                    >
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4.5 h-4.5 shrink-0">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      </svg>
                      Connect Google Drive
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-surface rounded-xl border border-line">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-ink truncate">{landingUser?.displayName || 'Authorized Account'}</p>
                          <p className="text-[10px] text-ink-soft truncate">{landingUser?.email}</p>
                        </div>
                        <button
                          onClick={handleDisconnectLandingDrive}
                          className="text-[10px] font-bold text-ink-soft hover:text-red-400 uppercase tracking-wider pl-2 cursor-pointer"
                        >
                          Sign Out
                        </button>
                      </div>

                      <div className="border border-line bg-surface/80 rounded-2xl p-3 flex flex-col">
                        <div className="flex items-center justify-between pb-2 border-b border-line mb-2">
                          <span className="text-[10px] font-black uppercase text-ink-soft tracking-wider">Project File Library</span>
                          <button
                            onClick={() => {
                              fetchLandingDriveFiles(landingToken);
                              setLandingSearchQuery('');
                            }}
                            className="p-1 text-ink-soft hover:text-ink transition-colors cursor-pointer"
                            title="Refresh list"
                          >
                            <RefreshCw size={12} className={isLoadingLandingDrive ? 'animate-spin' : ''} />
                          </button>
                        </div>

                        {/* Drive File Search Input */}
                        <div className="relative mb-2.5">
                          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-ink-soft">
                            <Search size={12} />
                          </span>
                          <input
                            type="text"
                            value={landingSearchQuery}
                            onChange={(e) => setLandingSearchQuery(e.target.value)}
                            placeholder="Search file in Google Drive..."
                            className="w-full pl-8 pr-7 py-1.5 bg-surface hover:bg-surface/90 focus:bg-surface/80 text-[11px] text-ink placeholder-ink-soft border border-line rounded-lg focus:outline-none focus:border-gold/50 transition-all font-medium"
                          />
                          {landingSearchQuery && (
                            <button
                              onClick={() => setLandingSearchQuery('')}
                              className="absolute inset-y-0 right-0 pr-2 flex items-center text-ink-soft hover:text-ink transition-colors cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>

                        <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                          {isLoadingLandingDrive ? (
                            <div className="text-[10px] text-ink-soft italic py-4 text-center flex items-center justify-center gap-1.5">
                              <RefreshCw size={12} className="animate-spin" />
                              Fetching from Drive...
                            </div>
                          ) : landingDriveFiles.length > 0 ? (
                            (() => {
                              const filtered = landingDriveFiles.filter((file) =>
                                file.name.toLowerCase().includes(landingSearchQuery.toLowerCase())
                              );
                              if (filtered.length === 0) {
                                return (
                                  <div className="text-[10px] text-ink-soft italic py-6 text-center">
                                    No matching files found
                                  </div>
                                );
                              }
                              return filtered.map((file) => (
                                <div
                                  key={file.id}
                                  onClick={() => handleLoadFromLandingDrive(file.id, file.name)}
                                  className="flex items-center justify-between p-2 hover:bg-surface rounded-xl cursor-pointer group transition-colors border border-transparent hover:border-line"
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <p className="text-xs font-bold text-ink truncate group-hover:text-gold transition-all">
                                      {file.name}
                                    </p>
                                    {file.modifiedTime && (
                                      <p className="text-[9px] text-ink-soft">
                                        Modified {new Date(file.modifiedTime).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                  <ChevronRight size={14} className="text-ink-soft group-hover:text-gold transition-all" />
                                </div>
                              ));
                            })()
                          ) : (
                            <div className="text-[10px] text-ink-soft italic py-6 text-center">
                              No plans found in folder
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div className="mt-12 text-[10px] font-semibold text-ink-soft uppercase tracking-widest text-center">
              GrainLink Suite © 2026 • Secure & Sandbox Compliant
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {/* Global Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-ink/70 backdrop-blur-md flex flex-col items-center justify-center z-50 transition-all duration-300">
          <Loader2 className="w-16 h-16 text-gold animate-spin mb-4" />
          <h3 className="text-xl font-bold tracking-tight text-ink uppercase">Generating Multi-Yard Report</h3>
          <p id="loading-text" className="text-sm text-ink-soft mt-2">
            {loadingText}
          </p>
        </div>
      )}

      {/* Main Sidebar */}
      <aside className="w-64 bg-surface border-r border-line flex flex-col z-20 shadow-2xl shrink-0 overflow-y-auto">
        <div 
          onClick={() => setShowLanding(true)}
          className="p-6 border-b border-line flex flex-col items-start cursor-pointer hover:bg-surface/40 transition-all group"
          title="Go to Switch Site / Project"
        >
          <div className="flex items-center gap-2">
            <span id="brand-logo-text" className="text-xl font-black text-ink tracking-tight group-hover:text-gold transition-colors font-display">
              Grain<span className="text-gold">Link</span>
            </span>
          </div>

          {/* Minimalist Auto-Save Indicator */}
          <div 
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 mt-3 select-none text-[10px] font-medium tracking-wide"
            title={
              localSaveError
                ? `${localSaveError} — your work may not survive a page refresh. Try freeing up space or using a different browser.`
                : landingToken
                ? (lastAutoSaved ? `Last auto-saved to Google Drive at ${lastAutoSaved.toLocaleTimeString()}` : 'Auto-saves your plan every 1 minute')
                : 'Connect Google Drive to enable cloud auto-save'
            }
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {localSaveError ? (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500 animate-pulse"></span>
              ) : landingToken ? (
                autoSaveError ? (
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                ) : isAutoSaving ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-gold-dark"></span>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </>
                )
              ) : (
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-line"></span>
              )}
            </span>
            <span className="text-[10px] font-semibold uppercase shrink-0 flex items-center gap-1">
              {localSaveError ? (
                <span className="text-red-500">not saving</span>
              ) : isAutoSaving ? (
                <span className="text-gold-dark animate-pulse">saving...</span>
              ) : landingToken ? (
                autoSaveError ? (
                  <span className="text-red-500">error saving</span>
                ) : (
                  <span className="text-emerald-500">autosave</span>
                )
              ) : (
                <span className="text-ink-soft">autosave offline</span>
              )}
              {landingToken && lastAutoSaved && (
                <span className="text-[9px] text-ink-soft font-mono shrink-0">
                  • {lastAutoSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).toLowerCase()}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Navigation Tab selection */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 font-semibold text-sm">
          <button
            onClick={() => navigateTo(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-ink-soft hover:bg-surface/70 hover:text-ink transition-all text-left cursor-pointer font-semibold"
          >
            <Home size={16} className="text-gold" />
            Home
          </button>

          <button
            onClick={() => navigateTo(false, 'dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-surface text-ink border-l-4 border-gold font-black'
                : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
            }`}
          >
            <LayoutDashboard size={16} className={activeTab === 'dashboard' ? 'text-gold' : ''} />
            Project Dashboard
          </button>

          <h2 className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink-soft px-4 pt-4 pb-1">Tools</h2>
          <button
            onClick={() => navigateTo(false, 'planner')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'planner'
                ? 'bg-surface text-ink border-l-4 border-gold font-black'
                : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
            }`}
          >
            <MapIcon size={16} className={activeTab === 'planner' ? 'text-gold' : ''} />
            Site Planner
          </button>
          <button
            onClick={() => navigateTo(false, 'estimator')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'estimator'
                ? 'bg-surface text-ink border-l-4 border-gold font-black'
                : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
            }`}
          >
            <Compass size={16} className={activeTab === 'estimator' ? 'text-gold' : ''} />
            Cable Lengths
          </button>
          <button
            onClick={() => navigateTo(false, 'binSpecs')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left cursor-pointer ${
              activeTab === 'binSpecs'
                ? 'bg-surface text-ink border-l-4 border-gold font-black'
                : 'text-ink-soft hover:bg-surface/70 hover:text-ink'
            }`}
          >
            <FileText size={16} className={activeTab === 'binSpecs' ? 'text-gold' : ''} />
            Bin Specs
          </button>

          {/* Shortcuts Help Panel */}
          <div className="pt-4 border-t border-line/70 mt-4 px-4 pb-2">
            <h2 className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink-soft mb-2.5">Shortcuts</h2>
            <div className="space-y-2 text-ink-soft font-semibold text-[10px]">
              <div className="flex justify-between items-center">
                <span>Undo</span>
                <span className="text-[8px] text-ink-soft font-mono bg-surface/90 px-1 rounded border border-line">Cmd+Z</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Duplicate</span>
                <span className="text-[8px] text-ink-soft font-mono bg-surface/90 px-1 rounded border border-line">Cmd+D</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Delete</span>
                <span className="text-[8px] text-ink-soft font-mono bg-surface/90 px-1 rounded border border-line">Del</span>
              </div>
            </div>
          </div>
        </nav>

        {/* Customer & Project Metadata Inputs */}
        <div className="p-6 border-t border-line bg-surface/60 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[9px] font-black uppercase text-ink-soft tracking-wider">
                Project ID
              </label>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopyProjectId}
                  className="p-1 text-ink-soft hover:text-gold transition-colors cursor-pointer"
                  title="Copy Unique Project ID"
                >
                  {copiedId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            <input
              type="text"
              value={project.id || ''}
              readOnly
              className="w-full bg-surface/70 border border-line rounded-lg px-3 py-2 text-xs text-gold font-mono font-bold outline-none transition-all cursor-not-allowed"
              placeholder="e.g. PRJ-102938"
            />
          </div>

          <div>
            <label className="block text-[9px] font-black uppercase text-ink-soft tracking-wider mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={project.name}
              onChange={(e) => updateProjectWithHistory((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink focus:border-gold outline-none transition-all font-semibold"
            />
          </div>

          <div>
            <label className="block text-[9px] font-black uppercase text-ink-soft tracking-wider mb-1">
              Customer Info
            </label>
            <button
              onClick={() => {
                setIsEditingCustomer(false);
                setShowCustomerModal(true);
              }}
              className="w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-xs text-ink font-semibold text-left hover:border-gold transition-all cursor-pointer flex items-center justify-between"
            >
              <span className="truncate">{project.customer.name || 'Add customer details'}</span>
              <ChevronRight size={14} className="text-ink-soft shrink-0" />
            </button>
          </div>
        </div>

        {showCustomerModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4"
            onClick={() => setShowCustomerModal(false)}
          >
            <div
              className="bg-surface rounded-2xl border border-line shadow-xl w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-black uppercase tracking-wider text-ink">Customer Info</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsEditingCustomer((prev) => !prev)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      isEditingCustomer ? 'bg-gold-light text-gold-dark' : 'text-ink-soft hover:text-gold hover:bg-paper'
                    }`}
                    title={isEditingCustomer ? 'Done editing' : 'Edit customer details'}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setShowCustomerModal(false)}
                    className="p-1.5 text-ink-soft hover:text-ink rounded-lg hover:bg-paper transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {([
                  { key: 'name', label: 'Customer Name', placeholder: '', type: 'text' },
                  { key: 'phone', label: 'Customer Phone', placeholder: '', type: 'text' },
                  { key: 'email', label: 'Customer Email', placeholder: 'customer@email.com', type: 'email' },
                  { key: 'location', label: 'Customer Location / Address', placeholder: 'e.g. Regina, SK', type: 'text' },
                ] as const).map((field) => (
                  <div key={field.key}>
                    <label className="block text-[9px] font-black uppercase text-ink-soft tracking-wider mb-1">
                      {field.label}
                    </label>
                    {isEditingCustomer ? (
                      <input
                        type={field.type}
                        value={(project.customer as any)[field.key] || ''}
                        onChange={(e) =>
                          updateProjectWithHistory((prev) => ({
                            ...prev,
                            customer: { ...prev.customer, [field.key]: e.target.value },
                          }))
                        }
                        placeholder={field.placeholder}
                        autoFocus={field.key === 'name'}
                        className="w-full bg-paper border border-line rounded-lg px-3 py-2 text-xs text-ink focus:border-gold outline-none transition-all font-semibold"
                      />
                    ) : (
                      <p className="text-xs text-ink font-semibold px-3 py-2 min-h-[34px] flex items-center">
                        {(project.customer as any)[field.key] || (
                          <span className="text-ink-soft font-normal italic">Not set</span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Global Unified PDF Report Export */}
        <div className="p-6 border-t border-line bg-surface flex flex-col gap-3">
          <label className="flex items-center gap-2.5 text-[10px] font-black uppercase text-ink-soft select-none cursor-pointer tracking-wider hover:text-ink transition-colors">
            <input
              type="checkbox"
              checked={includeAssetDirectory}
              onChange={(e) => setIncludeAssetDirectory(e.target.checked)}
              className="accent-gold h-3.5 w-3.5 rounded border-line bg-surface text-gold focus:ring-0 cursor-pointer"
            />
            Include Assets Directory Table
          </label>
          <button
            onClick={triggerPDFExport}
            className="w-full py-3.5 bg-gold hover:bg-gold-hover text-ink font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-gold/15 tracking-wider cursor-pointer"
          >
            GENERATE SUITE PDF
            <Download size={14} strokeWidth={2.5} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-screen relative flex flex-col bg-paper overflow-hidden">
        {/* Top Header Bar for View Context */}
        <header className="h-11 bg-surface border-b border-line px-6 flex items-center justify-between shrink-0 text-xs select-none z-10">
          <div className="flex items-center gap-3">
            <span className="font-extrabold uppercase tracking-widest text-ink-soft text-[11px]">
              {activeTab === 'dashboard' && 'Dashboard Overview'}
              {activeTab === 'planner' && 'Site Planner'}
              {activeTab === 'estimator' && 'Cable Lengths'}
              {activeTab === 'binSpecs' && 'Bin Specs'}
            </span>
            <span className="text-ink">•</span>
            <span className="font-black text-ink uppercase tracking-tight text-xs">{project.name}</span>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <DashboardView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSelectYard={(yardId) => updateProjectWithHistory((prev) => ({ ...prev, activeYardId: yardId }))}
            onSwitchTab={(tab) => navigateTo(false, tab)}
            onLocateAsset={handleLocateAsset}
            lastSavedTime={lastAutoSaved}
            onSaveComplete={() => setLastAutoSaved(new Date())}
          />
        )}

        {activeTab === 'planner' && (
          <SitePlannerView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSwitchTab={(tab) => navigateTo(false, tab)}
            onSelectBinInEstimator={handleSelectBinInEstimator}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
          />
        )}

        {activeTab === 'binSpecs' && (
          <BinSpecsView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSwitchTab={(tab) => navigateTo(false, tab)}
            activeBinId={activeBinId}
          />
        )}

        {activeTab === 'estimator' && (
          <CableEstimatorView
            project={project}
            onUpdateProject={updateProjectWithHistory}
            onSwitchTab={(tab) => navigateTo(false, tab)}
            activeBinId={activeBinId}
          />
        )}
      </main>

      {/* Hidden Rendering Area for html2canvas PDF Captures */}
      <div
        id="pdf-render-zone"
        className="fixed top-0 left-0 w-[800px] bg-surface text-ink z-[-1] opacity-0 pointer-events-none"
      />

      {/* GitHub Sync Modal */}
      {showGitModal && isDevMode && (
        <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-surface">
              <div className="flex items-center gap-2 text-ink">
                <Github size={18} className="text-gold" />
                <span className="font-black text-sm uppercase tracking-wider">Push to GitHub</span>
              </div>
              {!isPushingToGit && (
                <button
                  onClick={() => setShowGitModal(false)}
                  className="text-ink-soft hover:text-ink transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {isPushingToGit ? (
                <div className="py-10 flex flex-col items-center justify-center text-center space-y-4">
                  <Loader2 size={40} className="text-gold animate-spin" />
                  <div>
                    <h3 className="text-sm font-bold text-ink uppercase tracking-wider">Deploying changes...</h3>
                    <p className="text-xs text-ink-soft mt-1">Staging files and pushing to production repository branch.</p>
                  </div>
                </div>
              ) : gitResult ? (
                <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
                  {gitResult.success ? (
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
                      <AlertTriangle size={24} />
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-bold text-ink uppercase tracking-wider">
                      {gitResult.success ? 'Sync Completed!' : 'Sync Failed'}
                    </h3>
                    <p className="text-xs text-ink-soft mt-2 leading-relaxed px-4">
                      {gitResult.message}
                    </p>
                  </div>

                  <div className="pt-4 w-full">
                    <button
                      onClick={() => {
                        setShowGitModal(false);
                        setGitResult(null);
                      }}
                      className="w-full py-2.5 bg-surface hover:bg-paper text-ink rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-line cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-bold text-ink-soft uppercase tracking-widest block mb-2">
                      Modified Files ({gitStatus?.changes?.length || 0})
                    </span>
                    <div className="bg-surface border border-line rounded-xl p-3 max-h-36 overflow-y-auto font-mono text-[10px] text-ink-soft space-y-1">
                      {gitStatus?.changes && gitStatus.changes.length > 0 ? (
                        gitStatus.changes.map((change, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className={`font-bold uppercase ${
                              change.startsWith('M') ? 'text-gold' :
                              change.startsWith('A') || change.includes('??') ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {change.slice(0, 2)}
                            </span>
                            <span className="truncate">{change.slice(2)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-ink-soft py-4 uppercase tracking-wider">
                          No pending changes
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-ink-soft uppercase tracking-widest mb-1.5">
                      Commit Message
                    </label>
                    <input
                      type="text"
                      value={gitPushMessage}
                      onChange={(e) => setGitPushMessage(e.target.value)}
                      placeholder="e.g. Update grain bin dimensions"
                      className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-xs text-ink focus:border-gold outline-none transition-all font-semibold"
                    />
                  </div>

                  <div className="pt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowGitModal(false)}
                      className="flex-1 py-2.5 bg-surface hover:bg-paper text-ink-soft hover:text-ink rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border border-line cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGitPush(gitPushMessage)}
                      className="flex-1 py-2.5 bg-gold hover:bg-gold-hover text-ink rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-gold/15 cursor-pointer"
                    >
                      Push & Deploy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
