/**
 * Running the model in the browser.
 *
 * The dashboard never reads the stored `results` block from the data file. It
 * recalculates from the stored inputs on every render, which is the point of
 * shipping the engine to the browser: a reader can change a scenario and watch
 * the number move, and the figures on screen always follow from the
 * assumptions printed beside them.
 */

import { useMemo } from 'react';
import {
  DcfError,
  applyScenario,
  calculateDcf,
  calculateSensitivity,
} from '../../shared/dcf';
import type { DcfResult, ScenarioDefinition, ValuationSnapshot } from '../../shared/types';
import type { SensitivityCell } from '../../shared/dcf';

export type ScenarioKey = 'bear' | 'base' | 'bull';

export const SCENARIO_ORDER: ScenarioKey[] = ['bear', 'base', 'bull'];

export interface ValuationRun {
  result: DcfResult | null;
  error: string | null;
  errorCode: string | null;
}

export function runValuation(
  snapshot: ValuationSnapshot,
  scenarioKey: ScenarioKey = 'base',
): ValuationRun {
  const scenario: ScenarioDefinition =
    snapshot.scenarios?.[scenarioKey] ?? { label: scenarioKey, notes: '', overrides: {} };
  try {
    const assumptions =
      scenarioKey === 'base' ? snapshot.assumptions : applyScenario(snapshot.assumptions, scenario);
    return { result: calculateDcf(snapshot.historical, assumptions), error: null, errorCode: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : 'This model could not be calculated.',
      errorCode: error instanceof DcfError ? error.code : 'unknown',
    };
  }
}

export function useValuation(snapshot: ValuationSnapshot | null, scenarioKey: ScenarioKey): ValuationRun {
  return useMemo(() => {
    if (!snapshot) return { result: null, error: null, errorCode: null };
    return runValuation(snapshot, scenarioKey);
  }, [snapshot, scenarioKey]);
}

export function useSensitivity(
  snapshot: ValuationSnapshot | null,
  scenarioKey: ScenarioKey,
): SensitivityCell[][] {
  return useMemo(() => {
    if (!snapshot) return [];
    const scenario = snapshot.scenarios?.[scenarioKey] ?? { label: '', notes: '', overrides: {} };
    const assumptions =
      scenarioKey === 'base' ? snapshot.assumptions : applyScenario(snapshot.assumptions, scenario);
    return calculateSensitivity(snapshot.historical, assumptions, snapshot.sensitivity);
  }, [snapshot, scenarioKey]);
}

export interface ScenarioOutcome {
  key: ScenarioKey;
  label: string;
  notes: string;
  valuePerShare: number | null;
  enterpriseValue: number | null;
  waccPct: number | null;
  error: string | null;
}

export function useScenarioOutcomes(snapshot: ValuationSnapshot | null): ScenarioOutcome[] {
  return useMemo(() => {
    if (!snapshot) return [];
    return SCENARIO_ORDER.map((key) => {
      const definition = snapshot.scenarios?.[key];
      const run = runValuation(snapshot, key);
      return {
        key,
        label: definition?.label ?? key,
        notes: definition?.notes ?? '',
        valuePerShare: run.result?.intrinsicValuePerShare ?? null,
        enterpriseValue: run.result?.enterpriseValue ?? null,
        waccPct: run.result?.wacc.waccPct ?? null,
        error: run.error,
      };
    });
  }, [snapshot]);
}

export type { SensitivityCell };
