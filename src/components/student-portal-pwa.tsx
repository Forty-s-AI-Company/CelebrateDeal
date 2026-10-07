"use client";
import {useEffect} from "react";
/** Installation stores no account metadata and no offline mutations. */
export function StudentPortalPwa(){useEffect(()=>{if("serviceWorker" in navigator&&window.isSecureContext){void navigator.serviceWorker.register("/portal/sw.js",{scope:"/portal/",updateViaCache:"none"}).catch(()=>{ /* Online learning still works when installation is unavailable. */ });}},[]);return null;}
