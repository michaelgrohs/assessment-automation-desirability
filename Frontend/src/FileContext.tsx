import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:5000';

interface ExtractedElement {
  id: string;
  name: string;
}

interface TraceFitness {
  trace: string;
  conformance: number;
}
interface TraceSequence {
  trace: string;
  sequence: string[];
}
interface OutcomeBin {
  range: [number, number];
  traceCount: number;
  percentageEndingCorrectly: number;
}

export type ConformanceMode = 'bpmn' | 'declarative' | 'declarative-model';

interface DeviationSelection {
  column: string;   // exact matrix column name (e.g., "(Skip A)" or "Precedence_A_B")
  label: string;    // human-readable label
  type: string;     // 'skip' | 'insertion' | 'Precedence' | 'Response' | etc.
}

export interface AttributeConformanceItem {
  value: string;
  averageConformance: number;
  traceCount?: number;
}

export type AttributeConformanceMap = Record<string, AttributeConformanceItem[]>;

export interface UniqueSequenceBin {
  bin: number;
  uniqueSequences: number;
  sequences: string[][];
}

interface ConformanceBin {
  averageConformance: number;
  traceCount: number;
}

export interface ActivityDeviation {
  name: string;
  skipped: number;
  inserted: number;
  skipped_percent: number;
  inserted_percent: number;
}

interface ActivityDeviationResult {
  deviations: ActivityDeviation[];
  total_traces: number;
}

// ── Filter state ─────────────────────────────────────────────────────────────

export interface FilterSummary {
  /** Case IDs to exclude (from step 1 anomaly/outlier selection) */
  step1_exclude_ids: string[];
  /** Activity sequences (as string arrays) to remove in step 1 variant filtering */
  step1_variant_sequences: string[][];
  /** Deviation columns whose affected cases should be removed (step 1b) */
  step1b_remove_columns: string[];
  /** Activity sequences (as string arrays) whose cases should be removed (step 3) */
  step3_variant_sequences: string[][];
}

export interface FilterResult {
  isFiltered: boolean;
  originalCount: number;
  filteredCount: number;
  excludedCount: number;
  excludedByStep: Record<string, string[]>;
}

const EMPTY_FILTER_SUMMARY: FilterSummary = {
  step1_exclude_ids: [],
  step1_variant_sequences: [],
  step1b_remove_columns: [],
  step3_variant_sequences: [],
};

// ── Context type ──────────────────────────────────────────────────────────────

interface FileContextType {
  // Conformance mode
  conformanceMode: ConformanceMode;
  setConformanceMode: React.Dispatch<React.SetStateAction<ConformanceMode>>;

  // File contents
  bpmnFileContent: string | null;
  xesFileContent: string | null;

  amountConformanceData: any[];
  setAmountConformanceData: React.Dispatch<React.SetStateAction<any[]>>;

  // Extracted BPMN elements
  extractedElements: ExtractedElement[];

  // Conformance data
  fitnessData: TraceFitness[];
  conformanceBins: ConformanceBin[];

  // Activity deviation stats
  activityDeviations: ActivityDeviationResult;
  outcomeBins: OutcomeBin[];
  desiredOutcomes: string[];
  matching_mode: string;
  attributeConformance: AttributeConformanceMap;
  uniqueSequences: UniqueSequenceBin[];
  setUniqueSequences: React.Dispatch<React.SetStateAction<UniqueSequenceBin[]>>;

  // Setters
  setBpmnFileContent: (content: string | null) => void;
  setXesFileContent: (content: string | null) => void;
  setExtractedElements: (elements: ExtractedElement[]) => void;
  setFitnessData: (data: TraceFitness[]) => void;
  setConformanceBins: (bins: ConformanceBin[]) => void;
  setActivityDeviations: (data: ActivityDeviationResult) => void;
  setOutcomeBins: (bins: OutcomeBin[]) => void;
  setDesiredOutcomes: (outcomes: string[]) => void;
  setmatching_mode: (mode: string) => void;
  setAttributeConformance: (data: AttributeConformanceMap) => void;
  traceSequences: TraceSequence[];
  setTraceSequences: React.Dispatch<React.SetStateAction<TraceSequence[]>>;

  // Persisted dimension configuration from SelectDimensions
  dimensionConfigs: Record<string, any>;
  setDimensionConfigs: React.Dispatch<React.SetStateAction<Record<string, any>>>;

  // Deviation selection
  selectedDeviations: DeviationSelection[];
  setSelectedDeviations: React.Dispatch<React.SetStateAction<DeviationSelection[]>>;
  selectedDimensions: string[];
  setSelectedDimensions: React.Dispatch<React.SetStateAction<string[]>>;

  // Deviations identified as logging errors (excluded from Step 3 onwards)
  loggingErrorDeviations: string[];
  setLoggingErrorDeviations: React.Dispatch<React.SetStateAction<string[]>>;

  // Filter / recompute state
  filterSummary: FilterSummary;
  setFilterSummary: React.Dispatch<React.SetStateAction<FilterSummary>>;
  filterResult: FilterResult | null;
  setFilterResult: React.Dispatch<React.SetStateAction<FilterResult | null>>;
  /** Send full filter state to backend and recompute alignments. Returns the result object. */
  applyAndRecompute: (summary: FilterSummary) => Promise<FilterResult>;
  /** Clear all filters and restore original log. */
  clearAllFilters: () => Promise<void>;

  // Reset everything
  resetAll: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const FileContext = createContext<FileContextType | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export const FileProvider = ({ children }: { children: ReactNode }) => {
  const [conformanceMode, setConformanceMode] = useState<ConformanceMode>('bpmn');
  const [bpmnFileContent, setBpmnFileContent] = useState<string | null>(null);
  const [xesFileContent, setXesFileContent] = useState<string | null>(null);
  const [extractedElements, setExtractedElements] = useState<ExtractedElement[]>([]);
  const [fitnessData, setFitnessData] = useState<TraceFitness[]>([]);
  const [traceSequences, setTraceSequences] = useState<TraceSequence[]>([]);
  const [conformanceBins, setConformanceBins] = useState<ConformanceBin[]>([]);
  const [selectedDeviations, setSelectedDeviations] = useState<DeviationSelection[]>([]);
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);
  const [activityDeviations, setActivityDeviations] = useState<ActivityDeviationResult>({
    deviations: [],
    total_traces: 0,
  });
  const [uniqueSequences, setUniqueSequences] = useState<UniqueSequenceBin[]>([]);
  const [amountConformanceData, setAmountConformanceData] = useState<any[]>([]);
  const [dimensionConfigs, setDimensionConfigs] = useState<Record<string, any>>({});
  const [loggingErrorDeviations, setLoggingErrorDeviations] = useState<string[]>([]);
  const [outcomeBins, setOutcomeBins] = useState<OutcomeBin[]>([]);
  const [desiredOutcomes, setDesiredOutcomes] = useState<string[]>([]);
  const [matching_mode, setmatching_mode] = useState<string>('');
  const [attributeConformance, setAttributeConformance] = useState<AttributeConformanceMap>({});

  // Filter state
  const [filterSummary, setFilterSummary] = useState<FilterSummary>(EMPTY_FILTER_SUMMARY);
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);

  const applyAndRecompute = useCallback(async (summary: FilterSummary): Promise<FilterResult> => {
    const excluded_by_step: Record<string, string[]> = {
      step1: summary.step1_exclude_ids,
    };
    // Merge step1 and step3 variant sequences for the backend
    const allVariants = [...summary.step1_variant_sequences, ...summary.step3_variant_sequences];
    const res = await fetch(`${API_URL}/api/recompute-filtered-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exclude_case_ids: summary.step1_exclude_ids,
        deviations_to_remove_cases: summary.step1b_remove_columns,
        variants_to_remove: allVariants,
        excluded_by_step,
      }),
    });
    const data = await res.json();
    const result: FilterResult = {
      isFiltered: (data.excluded_count ?? 0) > 0,
      originalCount: data.original_count ?? 0,
      filteredCount: data.filtered_count ?? 0,
      excludedCount: data.excluded_count ?? 0,
      excludedByStep: data.excluded_by_step ?? {},
    };
    setFilterSummary(summary);
    setFilterResult(result);
    return result;
  }, []);

  const clearAllFilters = useCallback(async () => {
    const emptySummary = { ...EMPTY_FILTER_SUMMARY };
    await applyAndRecompute(emptySummary);
    setFilterSummary(emptySummary);
    setFilterResult(null);
  }, [applyAndRecompute]);

  const resetAll = () => {
    setConformanceMode('bpmn');
    setBpmnFileContent(null);
    setXesFileContent(null);
    setExtractedElements([]);
    setFitnessData([]);
    setTraceSequences([]);
    setConformanceBins([]);
    setSelectedDeviations([]);
    setSelectedDimensions([]);
    setActivityDeviations({ deviations: [], total_traces: 0 });
    setUniqueSequences([]);
    setAmountConformanceData([]);
    setOutcomeBins([]);
    setDesiredOutcomes([]);
    setmatching_mode('');
    setAttributeConformance({});
    setDimensionConfigs({});
    setLoggingErrorDeviations([]);
    setFilterSummary(EMPTY_FILTER_SUMMARY);
    setFilterResult(null);
  };

  return (
    <FileContext.Provider
      value={{
        conformanceMode, setConformanceMode,
        bpmnFileContent, xesFileContent,
        extractedElements,
        setBpmnFileContent, setXesFileContent, setExtractedElements,
        fitnessData, setFitnessData,
        conformanceBins, setConformanceBins,
        activityDeviations, setActivityDeviations,
        outcomeBins, setOutcomeBins,
        desiredOutcomes, setDesiredOutcomes,
        matching_mode, setmatching_mode,
        attributeConformance, setAttributeConformance,
        setUniqueSequences, uniqueSequences,
        amountConformanceData, setAmountConformanceData,
        traceSequences, setTraceSequences,
        selectedDeviations, setSelectedDeviations,
        selectedDimensions, setSelectedDimensions,
        dimensionConfigs, setDimensionConfigs,
        loggingErrorDeviations, setLoggingErrorDeviations,
        filterSummary, setFilterSummary,
        filterResult, setFilterResult,
        applyAndRecompute,
        clearAllFilters,
        resetAll,
      }}
    >
      {children}
    </FileContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useFileContext = (): FileContextType => {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFileContext must be used within a FileProvider');
  }
  return context;
};
