import {redirect} from "next/navigation";
/** Next canonicalizes /portal/ to /portal, outside the worker's /portal/ scope.
 * Keep the landing document inside that scope without broadening control. */
export default function PortalStartPage(){redirect("/portal/start/welcome");}
