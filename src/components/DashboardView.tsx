/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Project, Yard, Asset, BinAsset, generateProjectId, generateAssetId } from '../types';
import { getCableRecommendation } from '../utils/cableRecommendation';
import { computeBinCapacityBushels } from '../utils/binCapacity';
import { Plus, Edit2, Trash2, FolderOpen, Save, MapPin, Cloud, LogOut, RefreshCw, AlertTriangle, Check, Download, FileText, Copy } from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  logout,
  saveProjectToDrive,
  listProjectsFromDrive,
  loadProjectFromDrive,
  DriveFile
} from '../utils/googleDrive';
import { useDialogs } from './ui/DialogProvider';

interface DashboardViewProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onSelectYard: (yardId: number) => void;
  onSwitchTab: (tabId: 'dashboard' | 'planner' | 'estimator' | 'binSpecs') => void;
  onLocateAsset: (assetId: number) => void;
  lastSavedTime?: Date | null;
  onSaveComplete?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  project,
  onUpdateProject,
  onSelectYard,
  onSwitchTab,
  onLocateAsset,
  lastSavedTime,
  onSaveComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, promptText, toast } = useDialogs();

  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [isSavingDrive, setIsSavingDrive] = useState(false);
  const [driveSuccessMessage, setDriveSuccessMessage] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Local draft buffer for Project Notes: committing to global project
  // state (and its undo history) on every keystroke made typing sluggish on
  // larger projects, since it re-runs the stats aggregation above and
  // re-renders the whole dashboard tree. Debounce the commit instead.
  const [notesDraft, setNotesDraft] = useState(project.notes || '');
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNotesDraft(project.notes || '');
    // Only re-sync when a *different* project is loaded, not on every
    // notes change, otherwise this would fight the debounce below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    return () => {
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    };
  }, []);

  const handleNotesChange = useCallback((value: string) => {
    setNotesDraft(value);
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      onUpdateProject((prev) => ({ ...prev, notes: value }));
    }, 400);
  }, [onUpdateProject]);

  useEffect(() => {
    const unsubscribe = initAuth(
      (u, token) => {
        setUser(u);
        setAccessToken(token);
        fetchDriveFiles(token);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setDriveFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchDriveFiles = async (tokenToUse?: string) => {
    const tok = tokenToUse || accessToken;
    if (!tok) return;
    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await listProjectsFromDrive(tok);
      setDriveFiles(files);
    } catch (err: any) {
      console.error(err);
      setDriveError(err.message || 'Failed to list designs from Google Drive');
      if (isAuthError(err)) handleAuthFailure();
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const handleConnectDrive = async () => {
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        fetchDriveFiles(result.accessToken);
      }
    } catch (err: any) {
      setDriveError(err.message || 'Google Drive connection failed');
    }
  };

  const handleDisconnectDrive = async () => {
    setDriveError(null);
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setDriveFiles([]);
    } catch (err: any) {
      setDriveError(err.message || 'Sign out failed');
    }
  };

  // Google's access tokens expire after ~1hr; the API surfaces that a few
  // different ways depending on which call failed, so this is the one place
  // that needs to recognize all of them.
  const isAuthError = (err: any): boolean =>
    err?.message?.includes('expired') ||
    err?.message?.includes('re-authorize') ||
    err?.message?.includes('401') ||
    err?.status === 401;

  const handleAuthFailure = () => {
    logout().catch(console.error);
    setUser(null);
    setAccessToken(null);
    setDriveFiles([]);
  };

  const saveToDrive = async (token: string) => {
    const confirmed = await confirm(`Save design "${project.name}" to the connected Google Drive folder?`, {
      title: 'Save to Google Drive',
      confirmLabel: 'Save',
    });
    if (!confirmed) return;

    setIsSavingDrive(true);
    setDriveError(null);
    setDriveSuccessMessage(null);
    try {
      const savedFileId = await saveProjectToDrive(token, project);
      if (savedFileId && project.driveFileId !== savedFileId) {
        onUpdateProject((prev) => ({ ...prev, driveFileId: savedFileId }));
      }
      setDriveSuccessMessage('Saved to Google Drive successfully!');
      onSaveComplete?.();
      setTimeout(() => setDriveSuccessMessage(null), 4000);
      fetchDriveFiles(token);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to save to Google Drive');
      if (isAuthError(err)) handleAuthFailure();
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleSaveToDrive = async () => {
    if (!accessToken) return;
    await saveToDrive(accessToken);
  };

  const handleBackupToDriveClick = async () => {
    let currentToken = accessToken;
    if (!currentToken) {
      setDriveError(null);
      try {
        const result = await googleSignIn();
        if (!result) return;
        setUser(result.user);
        setAccessToken(result.accessToken);
        currentToken = result.accessToken;
      } catch (err: any) {
        setDriveError(err.message || 'Google Drive connection failed');
        return;
      }
    }

    await saveToDrive(currentToken);
  };

  const handleLoadFromDrive = async (fileId: string, fileName: string) => {
    if (!accessToken) return;
    const confirmed = await confirm(`Load design "${fileName}" from Google Drive? This will replace your current unsaved workspace.`, {
      title: 'Load Design',
      confirmLabel: 'Load',
    });
    if (!confirmed) return;

    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const loaded = await loadProjectFromDrive(accessToken, fileId);
      if (!loaded.id) {
        loaded.id = generateProjectId();
      }
      loaded.driveFileId = fileId;
      onUpdateProject(() => loaded);
      setDriveSuccessMessage(`Successfully loaded design "${fileName}"!`);
      setTimeout(() => setDriveSuccessMessage(null), 4000);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to load design');
      if (isAuthError(err)) handleAuthFailure();
    } finally {
      setIsLoadingDrive(false);
    }
  };

  // Compute stats. Memoized because this scans every bin in every yard, and
  // otherwise re-runs on every render (e.g. every keystroke in the Notes
  // textarea below) rather than only when the project's bins actually change.
  const {
    totalYards,
    totalCapacity,
    totalChesterX,
    totalChesterX1,
    totalJunctionBoxes,
    verifiedCableCount,
    largestBin,
    allBins,
    totalBins,
    avgBinCapacity,
  } = useMemo(() => {
    let totalCapacity = 0;
    let totalChesterX = 0;
    let totalChesterX1 = 0;
    let totalJunctionBoxes = 0;
    let verifiedCableCount = 0;
    let largestBin: { name: string; capacity: number; diameter: number } | null = null;
    const allBins: { yardName: string; bin: BinAsset }[] = [];

    project.yards.forEach((yard) => {
      yard.bins.forEach((b) => {
        if (b.type === 'bin') {
          const bin = b as BinAsset;
          allBins.push({ yardName: yard.name, bin });
          const cap = computeBinCapacityBushels(bin);
          totalCapacity += cap;
          if (bin.centerCable || bin.radiusCable) {
            verifiedCableCount++;
          }
          if (!largestBin || cap > largestBin.capacity) {
            largestBin = { name: bin.name || 'Unnamed bin', capacity: cap, diameter: parseFloat(bin.diameter) || 0 };
          }
        } else if (b.type === 'chester-x') {
          totalChesterX++;
        } else if (b.type === 'chester-x1') {
          totalChesterX1++;
        } else if (b.type === 'junction-box') {
          totalJunctionBoxes++;
        }
      });
    });

    const totalBins = allBins.length;
    const avgBinCapacity = totalBins > 0 ? Math.round(totalCapacity / totalBins) : 0;

    return {
      totalYards: project.yards.length,
      totalCapacity,
      totalChesterX,
      totalChesterX1,
      totalJunctionBoxes,
      verifiedCableCount,
      largestBin,
      allBins,
      totalBins,
      avgBinCapacity,
    };
  }, [project.yards]);

  // Yards CRUD actions
  const handleCreateYard = async () => {
    const name = await promptText('Enter new yard name:', `Yard ${project.yards.length + 1}`, {
      title: 'New Yard',
      confirmLabel: 'Create',
    });
    if (!name) return;

    const newId = generateAssetId();
    onUpdateProject((prev) => ({
      ...prev,
      activeYardId: newId,
      yards: [
        ...prev.yards,
        {
          id: newId,
          name,
          bins: [],
        },
      ],
    }));
  };

  const handleRenameYard = async (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const yard = project.yards.find((y) => y.id === yardId);
    if (!yard) return;

    const newName = await promptText('Rename Yard:', yard.name, { title: 'Rename Yard', confirmLabel: 'Rename' });
    if (!newName) return;

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => (y.id === yardId ? { ...y, name: newName } : y)),
    }));
  };

  const handleEditLocation = async (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const yard = project.yards.find((y) => y.id === yardId);
    if (!yard) return;

    const newLocation = await promptText('Enter Location Info for ' + yard.name + ':', yard.location || '', {
      title: 'Yard Location',
      confirmLabel: 'Save',
    });
    if (newLocation === null) return;

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => (y.id === yardId ? { ...y, location: newLocation } : y)),
    }));
  };

  const handleDeleteYard = async (yardId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.yards.length <= 1) {
      toast('Projects must contain at least one yard layout.', 'error');
      return;
    }

    const confirmed = await confirm('Are you sure you want to delete this yard and all its placed assets?', {
      title: 'Delete Yard',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    onUpdateProject((prev) => {
      const remainingYards = prev.yards.filter((y) => y.id !== yardId);
      const nextActiveId = prev.activeYardId === yardId ? remainingYards[0].id : prev.activeYardId;
      return {
        ...prev,
        activeYardId: nextActiveId,
        yards: remainingYards,
      };
    });
  };

  // JSON Save / Load
  const handleSaveProject = () => {
    const dataStr = JSON.stringify(project, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportName = project.name.replace(/\s+/g, '_').toLowerCase() + '_multiyard_project.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportName);
    linkElement.click();
  };

  const handleTriggerLoad = () => {
    fileInputRef.current?.click();
  };

  const handleLoadProjectJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        let loadedProject: Project;

        if (Array.isArray(imported)) {
          const mainYardId = generateAssetId();
          loadedProject = {
            id: generateProjectId(),
            name: 'Imported Legacy Layout',
            customer: { name: 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported }],
          };
        } else if (imported.bins && !imported.yards) {
          const mainYardId = generateAssetId();
          loadedProject = {
            id: imported.id || generateProjectId(),
            driveFileId: imported.driveFileId,
            name: imported.name || 'Imported Legacy Layout',
            customer: { name: imported.client || 'Legacy Cust', phone: '-' },
            date: new Date().toLocaleDateString(),
            activeYardId: mainYardId,
            yards: [{ id: mainYardId, name: 'Main Yard', bins: imported.bins }],
          };
        } else {
          loadedProject = {
            id: imported.id || generateProjectId(),
            driveFileId: imported.driveFileId,
            name: imported.name || 'Miller Site Layout',
            customer: imported.customer || { name: 'John Miller', phone: '555-0199' },
            date: imported.date || new Date().toLocaleDateString(),
            activeYardId: imported.activeYardId || (imported.yards?.[0]?.id || null),
            yards: imported.yards || [],
          };
        }

        // Normalize loadedProject bins and types to prevent crashes/unsupported fields
        loadedProject.yards = loadedProject.yards.map(yard => ({
          ...yard,
          bins: (yard.bins || []).map((bin: any) => {
            const type = bin.type || 'bin';
            if (type === 'bin') {
              return {
                id: bin.id || generateAssetId(),
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
                id: bin.id || generateAssetId(),
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
                id: bin.id || generateAssetId(),
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
          const defId = generateAssetId();
          loadedProject.yards.push({ id: defId, name: 'Home Yard', bins: [] });
          loadedProject.activeYardId = defId;
        }

        onUpdateProject(() => loadedProject);
        toast(`Imported "${loadedProject.name}" successfully.`, 'success');
      } catch (err) {
        toast('Invalid project format. Make sure the JSON file is a valid GrainLink layout.', 'error');
      } finally {
        // Reset so selecting the same file again re-fires onChange.
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div id="view-dashboard" className="flex-1 flex flex-col md:flex-row p-4 md:p-8 overflow-hidden gap-6 md:gap-8 h-full custom-scrollbar">
      {/* Left Side: Dashboard Stats and Inventory */}
      <div className="flex-[2] flex flex-col space-y-6 h-full overflow-hidden pr-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="dashboard-project-name" className="text-2xl md:text-3xl font-black text-ink tracking-tight uppercase">
              {project.name}
            </h2>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {/* Card 1: Combined Project Scope Overview */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between" style={{ background: '#FFFFFF', border: '1px solid rgba(43, 42, 37, 0.08)' }}>
            <span className="text-[10px] text-ink-soft font-black uppercase tracking-wider mb-2 block">Overview</span>
            <div className="grid grid-cols-3 gap-2 h-full items-center">
              {/* Total Capacity */}
              <div className="border-r border-line pr-2">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block">Total Capacity</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span id="stat-total-capacity" className="text-xl md:text-2xl font-bold text-gold font-mono">
                    {totalCapacity.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-ink-soft">BU</span>
                </div>
              </div>
              {/* Grain Bins */}
              <div className="border-r border-line px-2">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block">Grain Bins</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span id="stat-total-bins" className="text-xl md:text-2xl font-bold text-ink font-mono">
                    {totalBins}
                  </span>
                  <span className="text-[10px] font-bold text-ink-soft">{totalBins === 1 ? 'Bin' : 'Bins'}</span>
                </div>
              </div>
              {/* Yards Planned */}
              <div className="pl-2">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block">Yards Planned</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span id="stat-total-yards" className="text-xl md:text-2xl font-bold text-ink font-mono">
                    {totalYards}
                  </span>
                  <span className="text-[10px] font-bold text-ink-soft">{totalYards === 1 ? 'Yard' : 'Yards'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Placed Hardware Summary */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between" style={{ background: '#FFFFFF', border: '1px solid rgba(43, 42, 37, 0.08)' }}>
            <span className="text-[10px] text-ink-soft font-black uppercase tracking-wider mb-2 block">Equipment Summary</span>
            <div className="grid grid-cols-3 gap-1 h-full items-center text-center">
              {/* Chester-X */}
              <div className="border-r border-line px-1">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block mb-1">Chester-X</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-red-500 font-mono">
                    {totalChesterX}
                  </span>
                  <span className="text-[8px] font-black uppercase text-red-500/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
              {/* Chester-X1 */}
              <div className="border-r border-line px-1">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block mb-1">Chester-X1</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-blue-500 font-mono">
                    {totalChesterX1}
                  </span>
                  <span className="text-[8px] font-black uppercase text-blue-500/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
              {/* Junction Boxes */}
              <div className="px-1">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block mb-1">Junction Box</span>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-xl md:text-2xl font-bold text-emerald-400 font-mono">
                    {totalJunctionBoxes}
                  </span>
                  <span className="text-[8px] font-black uppercase text-emerald-400/50 tracking-widest mt-0.5">Placed</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cable Arrangement Reference Diagram */}
        <div className="glass-panel rounded-2xl overflow-hidden border border-line bg-surface">
          <div className="px-5 pt-5 pb-3 border-b border-line">
            <h3 className="text-xs font-black uppercase tracking-widest text-ink">Recommended Cable Arrangement</h3>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-line border-b border-line">
              {/* Header Row */}
              <div className="bg-surface/60 p-3 flex items-center justify-center">
                <span className="text-[10px] font-black uppercase text-ink-soft tracking-wider">Bin Diameter</span>
              </div>
              <div className="bg-surface/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-ink">Less than 24 ft</span>
              </div>
              <div className="bg-surface/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-ink">24 ft to 35 ft</span>
              </div>
              <div className="bg-surface/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-ink">36 ft to 41 ft</span>
              </div>
              <div className="bg-surface/40 p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-ink">42 ft to 47 ft+</span>
              </div>
            </div>

            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-line divide-y-0 bg-surface/10">
              {/* Diagram Row */}
              <div className="p-4 flex items-center justify-center border-b border-line bg-surface/20">
                <span className="text-[10px] font-black text-ink-soft uppercase leading-snug tracking-wide text-center">
                  Cable Position
                  <br />
                  Arrangement
                </span>
              </div>

              {/* Less than 24 ft */}
              <div className="p-4 flex items-center justify-center border-b border-line">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad1" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#F3E6D1" />
                      <stop offset="100%" stopColor="#FFFFFF" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad1)" stroke="#B8842E" strokeWidth="2.5" />
                  <circle cx="50" cy="50" r="6" fill="#B8842E" />
                </svg>
              </div>

              {/* 24-35 ft */}
              <div className="p-4 flex items-center justify-center border-b border-line">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad2" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#F3E6D1" />
                      <stop offset="100%" stopColor="#FFFFFF" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad2)" stroke="#B8842E" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="50" y2="24" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="72.5" y2="63" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="27.5" y2="63" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <circle cx="50" cy="24" r="5.5" fill="#B8842E" />
                  <circle cx="72.5" cy="63" r="5.5" fill="#B8842E" />
                  <circle cx="27.5" cy="63" r="5.5" fill="#B8842E" />
                </svg>
              </div>

              {/* 36-41 ft */}
              <div className="p-4 flex items-center justify-center border-b border-line">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad3" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#F3E6D1" />
                      <stop offset="100%" stopColor="#FFFFFF" />
                    </radialGradient>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad3)" stroke="#B8842E" strokeWidth="2.5" />
                  <line x1="50" y1="50" x2="50" y2="24" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="72.5" y2="63" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <line x1="50" y1="50" x2="27.5" y2="63" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
                  <circle cx="50" cy="50" r="6" fill="#B8842E" />
                  <circle cx="50" cy="24" r="5.5" fill="#B8842E" />
                  <circle cx="72.5" cy="63" r="5.5" fill="#B8842E" />
                  <circle cx="27.5" cy="63" r="5.5" fill="#B8842E" />
                </svg>
              </div>

              {/* 42-47 ft+ */}
              <div className="p-4 flex items-center justify-center border-b border-line">
                <svg viewBox="0 0 100 100" width="70" height="70">
                  <defs>
                    <radialGradient id="binGrad4" cx="45%" cy="38%" r="60%">
                      <stop offset="0%" stopColor="#F3E6D1" />
                      <stop offset="100%" stopColor="#FFFFFF" />
                    </radialGradient>
                    <clipPath id="binClip4">
                      <circle cx="50" cy="50" r="43" />
                    </clipPath>
                  </defs>
                  <circle cx="50" cy="50" r="44" fill="url(#binGrad4)" stroke="#B8842E" strokeWidth="2.5" />
                  <line x1="6" y1="50" x2="94" y2="50" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" clipPath="url(#binClip4)" />
                  <line x1="50" y1="6" x2="50" y2="94" stroke="#B8842E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" clipPath="url(#binClip4)" />
                  <circle cx="50" cy="50" r="6" fill="#B8842E" />
                  <circle cx="50" cy="25" r="5.5" fill="#B8842E" />
                  <circle cx="75" cy="50" r="5.5" fill="#B8842E" />
                  <circle cx="50" cy="75" r="5.5" fill="#B8842E" />
                  <circle cx="25" cy="50" r="5.5" fill="#B8842E" />
                </svg>
              </div>
            </div>

            <div className="min-w-[500px] grid grid-cols-[130px_1fr_1fr_1fr_1fr] text-center text-xs divide-x divide-line">
              {/* Cable Count Row */}
              <div className="bg-surface/20 p-3 flex items-center justify-center">
                <span className="text-[10px] font-black text-ink-soft uppercase leading-snug tracking-wide text-center">
                  Recommended
                  <br />
                  Number of
                  <br />
                  Cables
                </span>
              </div>
              <div className="p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-gold">1 Center</span>
              </div>
              <div className="p-3 flex items-center justify-center">
                <span className="text-[11px] font-black text-gold">3 Radius</span>
              </div>
              <div className="p-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[11px] font-black text-gold">1 Center</span>
                <span className="text-[11px] font-black text-gold">3 Radius</span>
              </div>
              <div className="p-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[11px] font-black text-gold">1 Center</span>
                <span className="text-[11px] font-black text-gold">4 Radius</span>
              </div>
            </div>
          </div>
        </div>

        {/* Project Stats */}
        <div className="glass-panel rounded-2xl flex-1 min-h-[180px] flex flex-col border border-line bg-surface overflow-hidden p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink mb-4">Project Stats</h3>

          <div className="space-y-5">
            {/* Cable verification progress */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-ink-soft font-bold uppercase tracking-wider">
                  Bins with Verified Cables
                </span>
                <span className="text-xs font-bold text-ink font-mono">
                  {verifiedCableCount} / {totalBins}
                </span>
              </div>
              <div className="h-2 w-full bg-paper rounded-full overflow-hidden border border-line">
                <div
                  className="h-full bg-gold rounded-full transition-all"
                  style={{ width: totalBins > 0 ? `${(verifiedCableCount / totalBins) * 100}%` : '0%' }}
                />
              </div>
              {totalBins > 0 && verifiedCableCount < totalBins && (
                <p className="text-[10px] text-ink-soft mt-1.5">
                  {totalBins - verifiedCableCount} bin{totalBins - verifiedCableCount === 1 ? '' : 's'} still using estimated cable lengths — measure in Cable Lengths for accurate figures.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              {/* Average bin capacity */}
              <div>
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block">
                  Average Bin Size
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-ink font-mono">
                    {avgBinCapacity.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-bold text-ink-soft">BU</span>
                </div>
              </div>

              {/* Junction boxes (not already surfaced elsewhere) */}
              <div>
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block">
                  Junction Boxes
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold text-ink font-mono">{totalJunctionBoxes}</span>
                </div>
              </div>
            </div>

            {/* Largest bin */}
            {largestBin && (
              <div className="pt-1 border-t border-line/60">
                <span className="text-[9px] text-ink-soft font-bold uppercase tracking-wider block mb-1">
                  Largest Bin
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-ink">{(largestBin as any).name}</span>
                  <span className="text-xs font-mono text-gold font-bold">
                    {(largestBin as any).capacity.toLocaleString()} BU
                  </span>
                </div>
              </div>
            )}

            {totalBins === 0 && (
              <div className="text-center py-4">
                <p className="text-ink-soft text-xs font-semibold mb-3">No bins added yet.</p>
                <button
                  onClick={() => onSwitchTab('planner')}
                  className="px-4 py-2 bg-gold hover:bg-gold-hover text-ink font-bold text-xs rounded-lg cursor-pointer transition-colors"
                >
                  Add your first bin
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Side: Yards Manager Panel + Project File Controls */}
      <div className="flex-1 max-w-sm flex flex-col gap-4 overflow-hidden shrink-0">
        {/* Save / Load Project File Actions (Compact) */}
        <div className="bg-surface rounded-2xl border border-line p-3 flex flex-col gap-2 shrink-0">
          {accessToken && (
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Cloud size={10} />
                Connected
              </span>
              <button
                onClick={handleDisconnectDrive}
                className="text-[9px] font-bold text-ink-soft hover:text-red-400 uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
                title="Sign out of Google Drive"
              >
                <LogOut size={10} />
                Disconnect
              </button>
            </div>
          )}

          {driveError && (
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-1.5 text-[10px] text-red-400">
              <AlertTriangle size={11} className="shrink-0 mt-0.5 text-red-500" />
              <span className="break-all text-[9px]">{driveError}</span>
            </div>
          )}

          {driveSuccessMessage && (
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-1.5 text-[10px] text-emerald-400">
              <Check size={11} className="shrink-0 text-emerald-400" />
              <span className="text-[9px]">{driveSuccessMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {/* 1. Back up to drive */}
            <button
              onClick={handleBackupToDriveClick}
              disabled={isSavingDrive}
              className={`py-2 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 border cursor-pointer transition-all ${
                isSavingDrive
                  ? 'bg-surface border-line text-ink-soft pointer-events-none'
                  : 'bg-gold border-gold hover:bg-gold text-ink shadow-sm'
              }`}
              title="Back up design to Google Drive"
            >
              {isSavingDrive ? (
                <>
                  <RefreshCw size={11} className="animate-spin text-ink-soft" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Cloud size={12} />
                  <span>Backup to Drive</span>
                </>
              )}
            </button>

            {/* 2. Export JSON file */}
            <button
              onClick={handleSaveProject}
              className="py-2 px-2 bg-surface hover:bg-surface text-ink border border-line text-[10px] font-bold uppercase rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              title="Export design as a local JSON file"
            >
              <Save size={12} className="text-gold" />
              <span>Export JSON</span>
            </button>

            {/* 3. Import JSON file */}
            <button
              onClick={handleTriggerLoad}
              className="col-span-2 py-2 px-2 bg-surface hover:bg-surface text-ink border border-line text-[10px] font-bold uppercase rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              title="Import a design from a local JSON file"
              aria-label="Import a design from a local JSON file"
            >
              <FolderOpen size={12} className="text-gold" />
              <span>Import JSON</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleLoadProjectJSON}
              accept=".json"
              className="hidden"
            />
          </div>
        </div>

        {/* Project Notes Container */}
        <div className="bg-surface rounded-2xl border border-line p-3.5 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
              <FileText size={13} className="text-gold" />
              Project Notes
            </h3>
            <span className="text-[9px] text-ink-soft uppercase font-bold tracking-wider">Exported to PDF</span>
          </div>
          <textarea
            value={notesDraft}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Type notes about the project here (e.g. site access instructions, installer notes, bin specs)..."
            rows={3}
            className="w-full bg-surface/80 border border-line focus:border-gold/50 rounded-xl p-2.5 text-xs text-ink-soft placeholder-ink-soft focus:outline-none transition-colors resize-y custom-scrollbar"
          />
        </div>

        {/* Yards Manager */}
        <div className="bg-surface rounded-2xl border border-line p-5 flex flex-col flex-grow overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink">Yards Manager</h3>
            <button
              onClick={handleCreateYard}
              className="px-3 py-1.5 bg-gold hover:bg-gold text-ink text-[10px] font-black uppercase rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Plus size={12} strokeWidth={3} />
              Add Yard
            </button>
          </div>
          <div id="yards-list" className="flex-grow overflow-y-auto space-y-3 pr-1 custom-scrollbar">
            {project.yards.map((yard) => {
              const isActive = yard.id === project.activeYardId;
              const totalBinsInYard = yard.bins.filter((b) => b.type === 'bin').length;
              const totalAssetsInYard = yard.bins.length;

              return (
                <div
                  key={yard.id}
                  onClick={() => onSelectYard(yard.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onSelectYard(yard.id);
                    onSwitchTab('planner');
                  }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-gold/5 border-gold/30'
                      : 'bg-surface border-line hover:bg-surface'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-sm ${isActive ? 'text-gold' : 'text-ink'}`}>
                      {yard.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleEditLocation(yard.id, e)}
                        className="p-1 hover:text-ink text-ink-soft transition-colors"
                        title="Edit Yard Location"
                        aria-label={`Edit location for ${yard.name}`}
                      >
                        <MapPin size={12} />
                      </button>
                      <button
                        onClick={(e) => handleRenameYard(yard.id, e)}
                        className="p-1 hover:text-ink text-ink-soft transition-colors"
                        title="Rename Yard"
                        aria-label={`Rename ${yard.name}`}
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteYard(yard.id, e)}
                        className="p-1 hover:text-red-400 text-ink-soft transition-colors"
                        title="Delete Yard"
                        aria-label={`Delete ${yard.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {yard.location ? (
                    <div className="text-[11px] text-gold/85 mt-1 flex items-center gap-1.5 font-medium leading-none">
                      <MapPin size={10} className="shrink-0 text-gold" />
                      <span className="truncate">{yard.location}</span>
                    </div>
                  ) : (
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditLocation(yard.id, e);
                      }}
                      className="text-[10px] text-ink-soft hover:text-ink-soft italic mt-1 flex items-center gap-1 cursor-pointer select-none"
                    >
                      <MapPin size={10} className="shrink-0 text-ink" />
                      <span>Add Location info...</span>
                    </div>
                  )}
                  <div className="text-[10px] text-ink-soft font-bold uppercase mt-2.5 flex justify-between border-t border-line/40 pt-1.5">
                    <span>{totalBinsInYard} Bins</span>
                    <span>{totalAssetsInYard} Assets Total</span>
                  </div>
                  <p className="text-[9px] text-ink-soft mt-1.5 font-bold">Double-click to open in planner</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
