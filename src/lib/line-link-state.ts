// Shared between the Settings card (which starts the flow) and the callback
// page (which finishes it). sessionStorage, not localStorage: it is scoped to
// the tab that started the flow and gone when that tab closes.
export const LINE_STATE_STORAGE_KEY = "phum-line-state";
