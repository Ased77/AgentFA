import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { SessionProvider } from "./lib/session";

export default function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
