import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { FileProvider } from "./FileContext";
import Layout from "./Layout";
import WelcomePage from "./WelcomePage";
import ViewBPMN from "./ViewBPMN";
import SelectDimensions from "./SelectDimensions";
import DeviationOverview from "./DeviationOverview";
import LogQualityCheck from "./LogQualityCheck";
import LogDeviations from "./LogDeviations";
import ModelCheck from "./ModelCheck";
import DeviationSelection from "./DeviationSelection";
import IssueGrouping from "./IssueGrouping";
import WorkaroundAnalysis from "./WorkaroundAnalysis";
import CausalResults from "./CausalResults";
import CriticalityResults from "./CriticalityResults";
import RisksOpportunities from "./RisksOpportunities";
import Recommendations from "./Recommendations";
import ViolationGuidelines from "./ViolationGuidelines";
import ActivityStats from "./ActivityStats";
import FinalReport from "./FinalReport";

const App: React.FC = () => {
  return (
    <FileProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/view-bpmn" element={<ViewBPMN />} />
            <Route path="/activity-stats" element={<ActivityStats />} />
            <Route path="/heatmap-aggr" element={<SelectDimensions />} />
            <Route path="/overview" element={<DeviationOverview />} />
            <Route path="/log-quality" element={<LogQualityCheck />} />
            <Route path="/log-deviations" element={<LogDeviations />} />
            <Route path="/model-check" element={<ModelCheck />} />
            <Route path="/deviation-selection" element={<DeviationSelection />} />
            <Route path="/issue-grouping" element={<IssueGrouping />} />
            <Route path="/workaround-analysis" element={<WorkaroundAnalysis />} />
            <Route path="/violation-guidelines" element={<ViolationGuidelines />} />
            <Route path="/select-dimensions" element={<SelectDimensions />} />
            <Route path="/causal-results" element={<CausalResults />} />
            <Route path="/criticality-results" element={<CriticalityResults />} />
            <Route path="/risks-opportunities" element={<RisksOpportunities />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/final-report" element={<FinalReport />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </FileProvider>
  );
};

export default App;










