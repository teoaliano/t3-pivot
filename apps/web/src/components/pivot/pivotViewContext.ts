import { createContext, use } from "react";

/** Set inside the Pivot view, where the top bar owns the Chat / Pivot switch. */
export const InPivotViewContext = createContext(false);

/** Whether the surrounding UI is the Pivot view. */
export const useInPivotView = () => use(InPivotViewContext);
