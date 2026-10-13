"use client";

// The store's display name, shown in the app's branding and page headings.
// Signed in, it's the name from Account → Store details (shared by every
// till and printed on receipts); before sign-in, the name of the store this
// device is connected to.
import { createContext, useContext } from "react";

export const StoreNameContext = createContext("Point of sale");

export function StoreName() {
  return <>{useContext(StoreNameContext)}</>;
}
