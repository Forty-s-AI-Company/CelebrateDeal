"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_REGISTRATION_LINKS, type FunnelRegistrationLinks } from "@/lib/funnel-registration-action";

const FunnelRegistrationLinkContext = createContext<FunnelRegistrationLinks>(EMPTY_REGISTRATION_LINKS);

/** Supplies the server-resolved forms and bound live to registration buttons (canvas, preview, popups, public). */
export function FunnelRegistrationLinkProvider({ value, children }: { value: FunnelRegistrationLinks; children: ReactNode }) {
  return <FunnelRegistrationLinkContext.Provider value={value}>{children}</FunnelRegistrationLinkContext.Provider>;
}

export function useFunnelRegistrationLinks(): FunnelRegistrationLinks {
  return useContext(FunnelRegistrationLinkContext);
}
