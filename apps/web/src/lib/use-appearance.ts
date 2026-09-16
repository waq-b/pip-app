import { useEffect, useState } from "react";
import { applyThemeChoice, readThemeChoice, storeThemeChoice, type ThemeChoice } from "./theme";

/**
 * Appearance for this device: follows the system until someone picks a side in
 * Setup. Lives apart from the component that uses it so the component file
 * exports components only, which is what keeps fast refresh working.
 */
export function useAppearance(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());

  useEffect(() => {
    applyThemeChoice(choice, document.documentElement);
  }, [choice]);

  return [
    choice,
    (next: ThemeChoice) => {
      storeThemeChoice(next);
      setChoice(next);
    },
  ];
}
