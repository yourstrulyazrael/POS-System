// Demo mode ("Try demo" on the sign-in screen): the app runs on sample data
// in this tab only. While it's on, the Supabase client is replaced by a
// stand-in that never contacts the server (lib/supabase/demo-client.ts) and
// the offline store writes nothing to the device, so nothing done in the demo
// is saved anywhere. Reloading or signing out ends it.

let demoMode = false;

export const isDemoMode = () => demoMode;

export function startDemoMode() {
  demoMode = true;
}

export function endDemoMode() {
  demoMode = false;
}

export const DEMO_USER_ID = "00000000-0000-4000-8000-00000000de30";
export const DEMO_NOT_AVAILABLE = "This isn’t available in the demo. Nothing you do in the demo is saved.";
