import { redirect } from "next/navigation";

// An instance's web UI is an app, not a brochure: the root goes straight to
// sign-in (which forwards already-authenticated sessions to /dashboard).
// Marketing lives on novacortex.dev, not on customer/self-host instances.
export default function RootRedirect() {
  redirect("/login");
}
