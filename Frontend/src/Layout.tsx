import React from "react";
import { AppBar, Toolbar, Typography, Avatar, Box, Button, Container, Chip, Collapse, IconButton } from "@mui/material";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { Outlet, useNavigate } from "react-router-dom";
import { BottomNavProvider, useBottomNav } from "./BottomNavContext";
import { useFileContext } from "./FileContext";
import StepProgressBar from "./StepProgressBar";
import FilterBanner from "./FilterBanner";

const ExclusionBanner: React.FC = () => {
  const { loggingErrorDeviations, processExceptionDeviations, outOfControlDeviations, deviationAffectedCounts, deviationLabels } = useFileContext();
  const [open, setOpen] = React.useState(false);

  const total = loggingErrorDeviations.length + processExceptionDeviations.length + outOfControlDeviations.length;
  if (total === 0) return null;

  const rows = [
    ...loggingErrorDeviations.map((c) => ({ col: c, tag: "Logging Error", step: "Step 1b", tagColor: "#b71c1c", tagBg: "rgba(183,28,28,0.08)" })),
    ...processExceptionDeviations.map((c) => ({ col: c, tag: "Process Exception", step: "Step 3", tagColor: "#c62828", tagBg: "rgba(211,47,47,0.08)" })),
    ...outOfControlDeviations.map((c) => ({ col: c, tag: "Out-of-control", step: "Step 3", tagColor: "#6a1b9a", tagBg: "rgba(106,27,154,0.08)" })),
  ];

  return (
    <Box sx={{ borderBottom: "1px solid #e0e0e0", backgroundColor: "#fafafa" }}>
      <Box
        display="flex" alignItems="center" gap={1} px={3} py={0.75}
        sx={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, color: "#555", flex: 1 }}>
          {total} deviation(s) excluded from further analysis
        </Typography>
        <Chip label={`${loggingErrorDeviations.length} logging error(s)`} size="small" variant="outlined"
          sx={{ fontSize: "0.58rem", height: 18, borderColor: "#ef9a9a", color: "#b71c1c" }} />
        <Chip label={`${processExceptionDeviations.length} process exception(s)`} size="small" variant="outlined"
          sx={{ fontSize: "0.58rem", height: 18, borderColor: "#ff8a65", color: "#c62828" }} />
        <Chip label={`${outOfControlDeviations.length} out-of-control`} size="small" variant="outlined"
          sx={{ fontSize: "0.58rem", height: 18, borderColor: "#ce93d8", color: "#6a1b9a" }} />
        <IconButton size="small" sx={{ p: 0 }}>
          {open ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box px={3} pb={1} display="flex" flexDirection="column" gap={0.25}>
          {rows.map(({ col, tag, step, tagColor, tagBg }) => {
            const count = deviationAffectedCounts[col];
            return (
              <Box key={col} display="flex" alignItems="center" gap={1}>
                <Chip label={tag} size="small"
                  sx={{ fontSize: "0.58rem", fontWeight: 700, height: 18, minWidth: 105, flexShrink: 0, backgroundColor: tagBg, color: tagColor }} />
                <Chip label={step} size="small" variant="outlined"
                  sx={{ fontSize: "0.56rem", height: 16, flexShrink: 0, color: "#888", borderColor: "#ccc" }} />
                <Typography variant="caption" sx={{ flex: 1 }}>{deviationLabels[col] ?? col}</Typography>
                {count !== undefined && (
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                    {count.toLocaleString("en-US")} trace(s) affected
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
};

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

const LayoutInner: React.FC = () => {
  const navigate = useNavigate();
  const { continueConfig, hideBack } = useBottomNav();
  const { resetAll } = useFileContext();

  const handleReset = async () => {
    try {
      await fetch(`${API_URL}/api/reset`, { method: "POST" });
    } catch (e) {
      console.warn("Failed to reset backend cache:", e);
    }
    resetAll();
    navigate("/");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top AppBar — sticky */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          backgroundColor: "#fff",
          borderBottom: "1px solid #e0e0e0",
          zIndex: 1100,
        }}
      >
        <Toolbar>
          <Typography
            variant="h6"
            sx={{ flexGrow: 1, color: "#333", fontWeight: 600 }}
          >
            Conformance Analysis
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RestartAltIcon />}
            onClick={handleReset}
            sx={{ mr: 2, color: "#757575", borderColor: "#bdbdbd" }}
          >
            Reset & Start Over
          </Button>
          <Avatar sx={{ bgcolor: "#e0e0e0" }}>
            <AccountCircleIcon sx={{ color: "#757575" }} />
          </Avatar>
        </Toolbar>
      </AppBar>

      {/* Step progress bar */}
      <StepProgressBar />

      {/* Filter status banner */}
      <FilterBanner />

      {/* Excluded deviations banner */}
      <ExclusionBanner />

      {/* Content — scrollable */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Box
            sx={{
              border: "1px solid #e0e0e0",
              borderRadius: 2,
              p: 3,
              backgroundColor: "#fff",
            }}
          >
            <Outlet />
          </Box>
        </Container>
      </Box>

      {/* Bottom Bar — sticky */}
      <Box
        sx={{
          backgroundColor: "#fff",
          borderTop: "1px solid #e0e0e0",
          px: 3,
          py: 1.5,
          flexShrink: 0,
        }}
      >
        <Container
          maxWidth="lg"
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {!hideBack ? (
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate(-1)}
            >
              Back
            </Button>
          ) : (
            <Box />
          )}

          {continueConfig ? (
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              disabled={continueConfig.disabled}
              onClick={continueConfig.onClick}
            >
              {continueConfig.label}
            </Button>
          ) : (
            <Box />
          )}
        </Container>
      </Box>
    </Box>
  );
};

const Layout: React.FC = () => {
  return (
    <BottomNavProvider>
      <LayoutInner />
    </BottomNavProvider>
  );
};

export default Layout;
