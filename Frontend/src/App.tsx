import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
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
import CausalResults from "./CausalResults";
import CriticalityResults from "./CriticalityResults";
import ViolationGuidelines from "./ViolationGuidelines";
import ActivityStats from "./ActivityStats";

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
            <Route path="/violation-guidelines" element={<ViolationGuidelines />} />
            <Route path="/select-dimensions" element={<SelectDimensions />} />
            <Route path="/causal-results" element={<CausalResults />} />
            <Route path="/criticality-results" element={<CriticalityResults />} />
          </Route>
        </Routes>
      </Router>
    </FileProvider>
  );
};

export default App;










