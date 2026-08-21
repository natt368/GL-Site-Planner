/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Project, BinAsset, BinSpecModel, generateAssetId } from '../types';
import { BIN_DATABASE, MANUFACTURERS, BIN_CATEGORIES } from '../data/binDatabase';
import { getCableRecommendation } from '../utils/cableRecommendation';
import { useDialogs } from './ui/DialogProvider';
import {
  Search,
  Plus,
  CheckCircle2,
  FileText,
  Zap,
  Info,
  X,
  Database,
  SlidersHorizontal,
  Save,
} from 'lucide-react';

interface BinSpecsViewProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onSwitchTab: (tabId: 'dashboard' | 'planner' | 'estimator' | 'binSpecs') => void;
  activeBinId: number | null;
}

export const BinSpecsView: React.FC<BinSpecsViewProps> = ({
  project,
  onUpdateProject,
  onSwitchTab,
  activeBinId,
}) => {
  const { toast, confirm } = useDialogs();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState('All Manufacturers');
  const [selectedCategory, setSelectedCategory] = useState('All Types');
  const [selectedSpecModel, setSelectedSpecModel] = useState<BinSpecModel>(BIN_DATABASE[0]);

  // Custom spec modal state
  const [showCustomModal, setShowCustomModal] = useState(false);

  useEffect(() => {
    if (!showCustomModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCustomModal(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showCustomModal]);

  const [customSpec, setCustomSpec] = useState({
    manufacturer: 'Custom',
    modelNumber: '',
    category: 'Flat Bottom' as 'Flat Bottom' | 'Hopper Bottom' | 'Smoothwall Hopper',
    diameterFt: 36,
    rings: 8,
    eaveHeightFt: 26,
    totalHeightFt: 35,
    capacityBushels: 20000,
    isHopper: false,
    hopperConeHeightFt: 8,
    notes: 'Custom farm spec entry',
  });

  // Local database state
  const [localDatabase, setLocalDatabase] = useState<BinSpecModel[]>(BIN_DATABASE);
  const [isLiveSynced, setIsLiveSynced] = useState<boolean>(false);
  const [excelSaveStatus, setExcelSaveStatus] = useState<string>('');

  // Persistent Verified Cable Lengths per bin model ID
  const [verifiedCableMap, setVerifiedCableMap] = useState<Record<string, { centerCable: string; radiusCable: string }>>(() => {
    try {
      const saved = localStorage.getItem('grainlink_verified_cables');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const getVerifiedForModel = (modelId: string | number) => {
    return verifiedCableMap[String(modelId)] || { centerCable: '', radiusCable: '' };
  };

  const handleVerifiedChange = (modelId: string | number, field: 'centerCable' | 'radiusCable', value: string) => {
    setVerifiedCableMap((prev) => {
      const key = String(modelId);
      const current = prev[key] || { centerCable: '', radiusCable: '' };
      const updatedModelVal = {
        ...current,
        [field]: value,
      };
      const updated = {
        ...prev,
        [key]: updatedModelVal,
      };
      try {
        localStorage.setItem('grainlink_verified_cables', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }

      // Automatically sync updated verified cable lengths to Excel spreadsheet asset
      if (selectedSpecModel && String(selectedSpecModel.id) === String(modelId)) {
        setExcelSaveStatus('Saving to Excel spreadsheet...');
        fetch('/api/bin-specs/update-verified-cables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelNumber: selectedSpecModel.modelNumber,
            originalModelNumber: selectedSpecModel.originalModelNumber,
            manufacturer: selectedSpecModel.manufacturer,
            centerCable: updatedModelVal.centerCable,
            radiusCable: updatedModelVal.radiusCable,
          }),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.success) {
              setExcelSaveStatus('Saved to Excel Spreadsheet!');
              setTimeout(() => setExcelSaveStatus(''), 3500);
            } else {
              setExcelSaveStatus('Saved locally');
              setTimeout(() => setExcelSaveStatus(''), 3000);
            }
          })
          .catch(() => {
            setExcelSaveStatus('Saved locally');
            setTimeout(() => setExcelSaveStatus(''), 3000);
          });
      }

      return updated;
    });
  };

  // Fetch dynamic bin specs from server API if Excel file is updated. In the
  // static production deployment this fetch always 404s and is a no-op.
  useEffect(() => {
    fetch('/api/bin-specs')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return res.json();
      })
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setLocalDatabase(res.data);
          setIsLiveSynced(true);

          // Populate verifiedCableMap with any existing verified lengths from Excel
          setVerifiedCableMap((prev) => {
            const next = { ...prev };
            let changed = false;
            res.data.forEach((m: BinSpecModel) => {
              if (m.verifiedCenterCableFt || m.verifiedRadiusCableFt) {
                const key = String(m.id);
                if (!next[key] || (!next[key].centerCable && !next[key].radiusCable)) {
                  next[key] = {
                    centerCable: m.verifiedCenterCableFt || '',
                    radiusCable: m.verifiedRadiusCableFt || '',
                  };
                  changed = true;
                }
              }
            });
            return changed ? next : prev;
          });

          if (!selectedSpecModel || selectedSpecModel.id === BIN_DATABASE[0]?.id) {
            setSelectedSpecModel(res.data[0]);
          }
        }
      })
      .catch((err) => {
        console.log('Using bundled static Excel database instance:', err);
      });
  }, []);

  // Derive active bin from project
  const activeBin = useMemo(() => {
    if (activeBinId === null) return null;
    for (const yard of project.yards) {
      const b = yard.bins.find((bin) => bin.id === activeBinId);
      if (b && b.type === 'bin') return b as BinAsset;
    }
    return null;
  }, [project.yards, activeBinId]);

  // Filtered search results
  const filteredSpecs = useMemo(() => {
    return localDatabase.filter((model) => {
      if (selectedManufacturer !== 'All Manufacturers' && model.manufacturer !== selectedManufacturer) {
        return false;
      }
      if (selectedCategory !== 'All Types' && model.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const terms = q.split(/\s+/);
        const targetString = `${model.manufacturer} ${model.modelNumber} ${model.fullName} ${model.category} ${model.diameterFt}ft ${model.capacityBushels}bu`.toLowerCase();
        // Check if all search terms match
        return terms.every((term) => targetString.includes(term));
      }
      return true;
    });
  }, [localDatabase, searchQuery, selectedManufacturer, selectedCategory]);

  // Handle adding custom model
  const handleSaveCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSpec.modelNumber.trim()) {
      toast('Please enter a model number.', 'error');
      return;
    }
    const newModel: BinSpecModel = {
      id: `custom-${generateAssetId()}`,
      manufacturer: customSpec.manufacturer || 'Custom',
      modelNumber: customSpec.modelNumber,
      fullName: `${customSpec.manufacturer} ${customSpec.modelNumber} ${customSpec.category}`,
      category: customSpec.category,
      isHopper: customSpec.isHopper,
      stiffened: false,
      diameterFt: Number(customSpec.diameterFt) || 30,
      rings: Number(customSpec.rings) || 8,
      eaveHeightFt: Number(customSpec.eaveHeightFt) || 26,
      totalHeightFt: Number(customSpec.totalHeightFt) || 35,
      floorThicknessFt: 1.5,
      hopperConeHeightFt: customSpec.isHopper ? Number(customSpec.hopperConeHeightFt) || 8 : undefined,
      capacityBushels: Number(customSpec.capacityBushels) || 15000,
      recommendedCablesCount: Math.max(1, Math.floor(Number(customSpec.diameterFt) / 10)),
      recommendedSensorsPerCable: Math.max(3, Math.floor(Number(customSpec.eaveHeightFt) / 6)),
      recommendedCableLengthFt: Math.max(10, Number(customSpec.eaveHeightFt) + 2),
      notes: customSpec.notes,
    };

    setLocalDatabase((prev) => [newModel, ...prev]);
    setSelectedSpecModel(newModel);
    setShowCustomModal(false);
    toast(`Successfully added ${newModel.fullName} to the library!`, 'success');
  };

  // Apply selected spec to active bin
  const handleApplyToActiveBin = (model: BinSpecModel) => {
    if (!activeBinId) {
      handleAddNewBinToProject(model);
      return;
    }

    const verified = getVerifiedForModel(model.id);

    onUpdateProject((prev) => ({
      ...prev,
      yards: prev.yards.map((y) => ({
        ...y,
        bins: y.bins.map((b) => {
          if (b.id !== activeBinId || b.type !== 'bin') return b;
          return {
            ...b,
            name: `${model.manufacturer} ${model.modelNumber}`,
            diameter: model.diameterFt.toString(),
            rings: model.rings.toString(),
            eaveHeight: model.eaveHeightFt.toString(),
            totalHeight: model.totalHeightFt.toString(),
            floorThick: (model.floorThicknessFt || 1.5).toString(),
            isHopper: model.isHopper,
            hopperConeHeight: model.hopperConeHeightFt ? model.hopperConeHeightFt.toString() : '8',
            manufacturer: model.manufacturer,
            modelNumber: model.modelNumber,
            capacityBushels: model.capacityBushels,
            centerCable: verified.centerCable || b.centerCable,
            radiusCable: verified.radiusCable || b.radiusCable,
            notes: model.notes || b.notes,
          };
        }),
      })),
    }));

    toast(`Applied ${model.fullName} dimensions to active bin #${activeBin?.name || activeBinId}!`, 'success');
  };

  // Add a new bin unit to project
  const handleAddNewBinToProject = (model: BinSpecModel) => {
    const activeYardId = project.activeYardId || project.yards[0]?.id;
    if (!activeYardId) return;

    const newId = generateAssetId();
    const newBinName = `${model.manufacturer} ${model.modelNumber}`;
    const verified = getVerifiedForModel(model.id);

    onUpdateProject((prev) => {
      const updatedYards = prev.yards.map((yard) => {
        if (yard.id !== activeYardId) return yard;

        const newBin: BinAsset = {
          id: newId,
          type: 'bin',
          name: newBinName,
          diameter: model.diameterFt.toString(),
          rings: model.rings.toString(),
          eaveHeight: model.eaveHeightFt.toString(),
          totalHeight: model.totalHeightFt.toString(),
          floorThick: (model.floorThicknessFt || 1.5).toString(),
          isHopper: model.isHopper,
          hopperConeHeight: model.hopperConeHeightFt ? model.hopperConeHeightFt.toString() : '8',
          manufacturer: model.manufacturer,
          modelNumber: model.modelNumber,
          capacityBushels: model.capacityBushels,
          centerCable: verified.centerCable,
          radiusCable: verified.radiusCable,
          notes: model.notes || `Spec: ${model.fullName}`,
          x: 200 + (yard.bins.length % 5) * 65,
          y: 200 + Math.floor(yard.bins.length / 5) * 65,
          measurements: [],
        };

        return {
          ...yard,
          bins: [...yard.bins, newBin],
        };
      });

      return { ...prev, yards: updatedYards };
    });

    toast(`Added ${model.fullName} to your project yard!`, 'success');
  };

  return (
    <div id="view-bin-specs" className="flex-1 flex flex-col h-full w-full overflow-hidden bg-paper text-ink-soft select-none">
      {/* Top Header Bar */}
      <header className="bg-surface border-b border-line px-6 py-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold">
            <FileText size={22} />
          </div>
          <div>
            <h1 className="text-base font-extrabold uppercase tracking-wider text-ink">
              Grain Bin Specifications Library
            </h1>
            <p className="text-xs text-ink-soft">
              Powered by official manufacturer catalogue data
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {excelSaveStatus && (
            <span className="text-xs font-mono font-bold text-gold bg-gold/10 border border-gold/30 px-3 py-1 rounded-full animate-pulse flex items-center gap-1.5">
              <Save size={13} />
              {excelSaveStatus}
            </span>
          )}
        </div>
      </header>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface p-6 space-y-6">
        {/* Search Engine Control Panel */}
        <div className="glass-panel p-5 rounded-2xl border border-line bg-surface/90 shadow-xl space-y-4">
          {/* Primary Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1 flex items-center">
              <Search size={20} className="absolute left-4 text-gold pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search model number or brand e.g. 'Brock 3310', 'Westeel 1505', 'Meridian 1615'..."
                className="w-full pl-12 pr-20 py-3.5 bg-surface border-2 border-line rounded-xl text-sm font-bold text-ink placeholder-ink-soft focus:border-gold focus:ring-1 focus:ring-gold outline-none transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 text-ink-soft hover:text-ink text-xs font-bold px-2.5 py-1 bg-surface hover:bg-line rounded cursor-pointer transition-all"
                >
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={() => setShowCustomModal(true)}
              className="px-4 py-3.5 bg-gold hover:bg-gold text-ink font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shrink-0"
            >
              <Plus size={16} />
              Add Custom Spec
            </button>
          </div>

          {/* Filter Dropdowns Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-line">
            {/* Manufacturer Filter */}
            <div>
              <label className="block text-[10px] text-ink-soft font-bold uppercase tracking-wider mb-1">
                Brand / Manufacturer
              </label>
              <select
                value={selectedManufacturer}
                onChange={(e) => setSelectedManufacturer(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-xs font-bold text-ink-soft outline-none focus:border-gold"
              >
                {MANUFACTURERS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-[10px] text-ink-soft font-bold uppercase tracking-wider mb-1">
                Bin Category / Bottom Type
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-xs font-bold text-ink-soft outline-none focus:border-gold"
              >
                {BIN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Count Indicator */}
            <div className="flex items-end justify-between px-3 py-2 bg-surface border border-line rounded-lg">
              <span className="text-[10px] text-ink-soft font-bold uppercase">Library Matches:</span>
              <span className="text-sm font-extrabold font-mono text-gold">
                {filteredSpecs.length} {filteredSpecs.length === 1 ? 'Model' : 'Models'}
              </span>
            </div>
          </div>
        </div>

        {/* Dual Column: Results List & Detailed Spec Inspector */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
          {/* Left Column: Spec Cards List */}
          <div className="lg:col-span-5 flex flex-col space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            {filteredSpecs.length === 0 ? (
              <div className="p-8 text-center bg-surface/50 border border-line rounded-2xl space-y-3">
                <Info size={32} className="mx-auto text-ink-soft" />
                <p className="text-sm font-bold text-ink-soft">
                  No grain bin models match &quot;{searchQuery}&quot;
                </p>
                <p className="text-xs text-ink-soft">
                  Try searching by brand (e.g., Brock, Westeel, GSI) or click &quot;Add Custom Spec&quot; to define your model.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedManufacturer('All Manufacturers');
                    setSelectedCategory('All Types');
                  }}
                  className="px-4 py-2 bg-surface hover:bg-line text-xs font-bold rounded-lg text-gold"
                >
                  Reset Search Filters
                </button>
              </div>
            ) : (
              filteredSpecs.map((model) => {
                const isSelected = selectedSpecModel.id === model.id;
                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedSpecModel(model)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'bg-gold/10 border-gold shadow-lg shadow-gold/10'
                        : 'bg-surface border-line hover:border-line hover:bg-surface/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 bg-surface text-gold border border-line rounded text-[9px] font-black uppercase tracking-wider">
                            {model.manufacturer}
                          </span>
                          <span className="px-2 py-0.5 bg-surface text-ink-soft rounded text-[9px] font-bold uppercase">
                            {model.category}
                          </span>
                        </div>
                        <h3 className="text-sm font-black text-ink">{model.fullName}</h3>
                      </div>
                      {isSelected && (
                        <CheckCircle2 size={18} className="text-gold shrink-0 mt-0.5" />
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-paper p-2.5 rounded-lg text-center text-xs font-mono">
                      <div>
                        <span className="block text-[8px] text-ink-soft uppercase font-sans">Diameter</span>
                        <span className="font-extrabold text-ink-soft">{model.diameterFt}&apos;</span>
                      </div>
                      <div>
                        <span className="block text-[8px] text-ink-soft uppercase font-sans">Height</span>
                        <span className="font-extrabold text-ink-soft">{model.eaveHeightFt}&apos;</span>
                      </div>
                      <div>
                        <span className="block text-[8px] text-ink-soft uppercase font-sans">Peak Ht</span>
                        <span className="font-extrabold text-ink-soft">{model.totalHeightFt}&apos;</span>
                      </div>
                      <div>
                        <span className="block text-[8px] text-ink-soft uppercase font-sans">Capacity</span>
                        <span className="font-extrabold text-gold">
                          {model.capacityBushels.toLocaleString()} BU
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Spec Inspector Sheet */}
          <div className="lg:col-span-7 bg-surface border border-line rounded-2xl p-6 flex flex-col overflow-y-auto custom-scrollbar space-y-6">
            {/* Header Info */}
            <div className="border-b border-line pb-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-gold text-ink font-extrabold text-xs rounded-md uppercase tracking-wider">
                    {selectedSpecModel.manufacturer}
                  </span>
                  <span className="px-2.5 py-1 bg-surface text-ink-soft font-bold text-xs rounded-md uppercase">
                    {selectedSpecModel.category}
                  </span>
                  {selectedSpecModel.stiffened && (
                    <span className="px-2 py-1 bg-surface text-gold border border-gold/30 text-[10px] font-bold rounded-md">
                      Stiffened Sidewalls
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-ink-soft">Model #: {selectedSpecModel.modelNumber}</span>
              </div>
              <h2 className="text-xl font-extrabold text-ink">{selectedSpecModel.fullName}</h2>
              {selectedSpecModel.notes && (
                <p className="text-xs text-ink-soft leading-relaxed">{selectedSpecModel.notes}</p>
              )}
            </div>

            {/* 4 Key Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface p-3.5 rounded-xl border border-line">
                <span className="block text-[9px] text-ink-soft font-black uppercase">Bin Diameter</span>
                <span className="text-xl font-extrabold font-mono text-ink">{selectedSpecModel.diameterFt}&apos;</span>
              </div>
              <div className="bg-surface p-3.5 rounded-xl border border-line">
                <span className="block text-[9px] text-ink-soft font-black uppercase">Eave / Peak Ht</span>
                <span className="text-xl font-extrabold font-mono text-ink">
                  {selectedSpecModel.eaveHeightFt}&apos; / {selectedSpecModel.totalHeightFt}&apos;
                </span>
              </div>
              <div className="bg-surface p-3.5 rounded-xl border border-line">
                <span className="block text-[9px] text-ink-soft font-black uppercase">Max Capacity</span>
                <span className="text-xl font-extrabold font-mono text-gold">
                  {selectedSpecModel.capacityBushels.toLocaleString()} <span className="text-xs">BU</span>
                </span>
              </div>
              <div className="bg-surface p-3.5 rounded-xl border border-line">
                <span className="block text-[9px] text-ink-soft font-black uppercase">Rings Count</span>
                <span className="text-xl font-extrabold font-mono text-ink">
                  {selectedSpecModel.rings} Rings
                </span>
              </div>
            </div>

            {/* Detailed Technical Specs Grid */}
            <div className="bg-surface p-5 rounded-xl border border-line space-y-4">
              <h4 className="text-xs font-black uppercase text-gold tracking-wider">Full Technical Specifications</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {(() => {
                  const rec = getCableRecommendation(selectedSpecModel.diameterFt.toString());
                  const cableParts = [];
                  if (rec.center > 0) cableParts.push(`${rec.center} Center`);
                  if (rec.radius > 0) cableParts.push(`${rec.radius} Radius`);
                  const cableText = cableParts.length > 0 ? `${cableParts.join(' + ')} (${rec.center + rec.radius} Total Cables)` : 'None';
                  return (
                    <div className="flex justify-between border-b border-line pb-2 col-span-1 sm:col-span-2">
                      <span className="text-ink-soft font-bold">Recommended Cables (Dashboard Spec):</span>
                      <span className="text-gold font-mono font-bold">{cableText}</span>
                    </div>
                  );
                })()}
                {selectedSpecModel.isHopper && (
                  <div className="flex justify-between border-b border-line pb-2">
                    <span className="text-ink-soft font-bold">Hopper Cone Ht &amp; Angle:</span>
                    <span className="text-gold font-mono font-bold">
                      {selectedSpecModel.hopperConeHeightFt || 8}&apos; ({selectedSpecModel.hopperConeAngleDeg || 45}°)
                    </span>
                  </div>
                )}
                {selectedSpecModel.doorType && (
                  <div className="flex justify-between border-b border-line pb-2 col-span-1 sm:col-span-2">
                    <span className="text-ink-soft font-bold">Door Assembly Type:</span>
                    <span className="text-ink font-bold">{selectedSpecModel.doorType}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Persistent Verified Cable Lengths Section */}
            <div className="bg-surface p-5 rounded-xl border border-line space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-emerald-400 tracking-wider">
                  Verified Cable Lengths
                </h4>
                <span className="text-[10px] text-ink-soft font-mono">Persists per bin spec model</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-ink-soft uppercase mb-1">
                    Center Verified Cable Length
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={getVerifiedForModel(selectedSpecModel.id).centerCable}
                      onChange={(e) => handleVerifiedChange(selectedSpecModel.id, 'centerCable', e.target.value)}
                      placeholder="e.g. 38"
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 pr-8 text-sm text-ink font-mono font-bold focus:border-gold outline-none"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-ink-soft font-mono font-bold">FT</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-ink-soft uppercase mb-1">
                    Verified Radius Cable Length
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={getVerifiedForModel(selectedSpecModel.id).radiusCable}
                      onChange={(e) => handleVerifiedChange(selectedSpecModel.id, 'radiusCable', e.target.value)}
                      placeholder="e.g. 34"
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 pr-8 text-sm text-ink font-mono font-bold focus:border-gold outline-none"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-ink-soft font-mono font-bold">FT</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => handleApplyToActiveBin(selectedSpecModel)}
                className="flex-1 py-3 px-4 bg-gold hover:bg-gold text-ink font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg"
              >
                <Zap size={16} />
                Apply Specs to Active Bin
              </button>
              <button
                onClick={() => handleAddNewBinToProject(selectedSpecModel)}
                className="flex-1 py-3 px-4 bg-surface hover:bg-line text-ink font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer border border-line"
              >
                <Plus size={16} />
                Add Bin to Project Yard
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Custom Spec Modal */}
      {showCustomModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4 gl-animate-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCustomModal(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-surface border border-line rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl gl-animate-dialog max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-extrabold text-ink flex items-center gap-2">
                <Plus size={18} className="text-gold" />
                Add Custom Bin Spec Model
              </h3>
              <button
                onClick={() => setShowCustomModal(false)}
                className="text-ink-soft hover:text-ink p-1"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCustomModel} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={customSpec.manufacturer}
                    onChange={(e) => setCustomSpec({ ...customSpec, manufacturer: e.target.value })}
                    placeholder="e.g. Brock / Westeel"
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Model Number</label>
                  <input
                    type="text"
                    value={customSpec.modelNumber}
                    onChange={(e) => setCustomSpec({ ...customSpec, modelNumber: e.target.value })}
                    placeholder="e.g. 3310 / 1505"
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Category</label>
                  <select
                    value={customSpec.category}
                    onChange={(e) =>
                      setCustomSpec({
                        ...customSpec,
                        category: e.target.value as any,
                        isHopper: e.target.value.includes('Hopper'),
                      })
                    }
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                  >
                    <option value="Flat Bottom">Flat Bottom</option>
                    <option value="Hopper Bottom">Hopper Bottom</option>
                    <option value="Smoothwall Hopper">Smoothwall Hopper</option>
                  </select>
                </div>
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Diameter (ft)</label>
                  <input
                    type="number"
                    value={customSpec.diameterFt}
                    onChange={(e) => setCustomSpec({ ...customSpec, diameterFt: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Rings</label>
                  <input
                    type="number"
                    value={customSpec.rings}
                    onChange={(e) => setCustomSpec({ ...customSpec, rings: Number(e.target.value) })}
                    className="w-full px-2 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Eave Ht (ft)</label>
                  <input
                    type="number"
                    value={customSpec.eaveHeightFt}
                    onChange={(e) => setCustomSpec({ ...customSpec, eaveHeightFt: Number(e.target.value) })}
                    className="w-full px-2 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-ink-soft font-bold uppercase mb-1">Capacity (BU)</label>
                  <input
                    type="number"
                    value={customSpec.capacityBushels}
                    onChange={(e) => setCustomSpec({ ...customSpec, capacityBushels: Number(e.target.value) })}
                    className="w-full px-2 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-ink-soft font-bold uppercase mb-1">Notes / Description</label>
                <textarea
                  value={customSpec.notes}
                  onChange={(e) => setCustomSpec({ ...customSpec, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-ink font-bold outline-none focus:border-gold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="px-4 py-2 bg-surface text-ink-soft font-bold rounded-lg hover:bg-line"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gold text-ink font-extrabold rounded-lg hover:bg-gold"
                >
                  Save Model to Library
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
