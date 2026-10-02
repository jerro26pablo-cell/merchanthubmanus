import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/marketplace" component={Home} />
      <Route path="/auctions" component={Home} />
      <Route path="/auction/:id" component={Home} />
      <Route path="/item/:id" component={Home} />
      <Route path="/compare/:baseId/:candidateId" component={Home} />
      <Route path="/compare/:baseId" component={Home} />
      <Route path="/checkout/:id" component={Home} />
      <Route path="/order/:id" component={Home} />
      <Route path="/orders" component={Home} />
      <Route path="/payments" component={Home} />
      <Route path="/rider" component={Home} />
      <Route path="/inventory" component={Home} />
      <Route path="/store" component={Home} />
      <Route path="/store/:id" component={Home} />
      <Route path="/messages" component={Home} />
      <Route path="/saved" component={Home} />
      <Route path="/bidding" component={Home} />
      <Route path="/bidding/:id" component={Home} />
      <Route path="/wallet" component={Home} />
      <Route path="/admin-dashboard" component={Home} />
      <Route path="/admin" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
