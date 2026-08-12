import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Pricing from "./pages/Pricing";
import Billing from "./pages/Billing";
import PlatformAdmin from "./pages/PlatformAdmin";
import Team from "./pages/Team";
import Projects from "./pages/Projects";
import MeasurementCanvas from "./pages/MeasurementCanvas";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/login"} component={Login} />
      <Route path={"/signup"} component={Signup} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/billing"} component={Billing} />
      <Route path={"/platform-admin"} component={PlatformAdmin} />
      <Route path={"/team"} component={Team} />
      <Route path={"/projects"} component={Projects} />
      <Route path={"/project/:id"} component={MeasurementCanvas} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
