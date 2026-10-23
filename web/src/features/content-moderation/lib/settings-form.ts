/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import * as z from 'zod'

export const MODERATION_OPTION_PREFIX = 'content_moderation_setting.'

export const MODERATION_CATEGORIES = [
  'harassment',
  'harassment/threatening',
  'hate',
  'hate/threatening',
  'illicit',
  'illicit/violent',
  'self-harm',
  'self-harm/intent',
  'self-harm/instructions',
  'sexual',
  'sexual/minors',
  'violence',
  'violence/graphic',
] as const

const thresholdValue = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === '' ||
      (Number.isFinite(Number(value)) &&
        Number(value) > 0 &&
        Number(value) <= 1),
    { message: 'Enter a number greater than 0 and at most 1' }
  )

export const moderationSettingsSchema = z.object({
  mode: z.enum(['off', 'observe', 'block']),
  keywords: z.string(),
  openai_enabled: z.boolean(),
  openai_base_url: z.string().trim(),
  openai_api_key: z.string().trim(),
  openai_model: z.string().trim().min(1),
  timeout_ms: z.number().int().min(500).max(30000),
  check_images: z.boolean(),
  category_thresholds: z.record(z.string(), thresholdValue),
  auto_ban_enabled: z.boolean(),
  auto_ban_threshold: z.number().int().min(1).max(100000),
  auto_ban_window_hours: z.number().int().min(1).max(87600),
  exempt_user_ids: z.string(),
  include_groups: z.string(),
  include_models: z.string(),
  exclude_models: z.string(),
  log_retention_days: z.number().int().min(0).max(3650),
})

export type ModerationSettingsValues = z.infer<typeof moderationSettingsSchema>

type ScalarKey = Exclude<keyof ModerationSettingsValues, 'category_thresholds'>

const DEFAULT_VALUES: ModerationSettingsValues = {
  mode: 'off',
  keywords: '',
  openai_enabled: false,
  openai_base_url: 'https://api.openai.com',
  openai_api_key: '',
  openai_model: 'omni-moderation-latest',
  timeout_ms: 3000,
  check_images: false,
  category_thresholds: {},
  auto_ban_enabled: false,
  auto_ban_threshold: 10,
  auto_ban_window_hours: 720,
  exempt_user_ids: '',
  include_groups: '',
  include_models: '',
  exclude_models: '',
  log_retention_days: 180,
}

function emptyThresholds(): Record<string, string> {
  return Object.fromEntries(
    MODERATION_CATEGORIES.map((category) => [category, ''])
  )
}

function parseThresholds(raw: string | undefined): Record<string, string> {
  const thresholds = emptyThresholds()
  if (!raw) return thresholds
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return thresholds
    for (const [category, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && value > 0) {
        thresholds[category] = String(value)
      }
    }
  } catch {
    return thresholds
  }
  return thresholds
}

export function moderationValuesFromOptions(
  options: { key: string; value: string }[]
): ModerationSettingsValues {
  const stored = new Map<string, string>()
  for (const option of options) {
    if (option.key.startsWith(MODERATION_OPTION_PREFIX)) {
      stored.set(
        option.key.slice(MODERATION_OPTION_PREFIX.length),
        option.value
      )
    }
  }
  const values: ModerationSettingsValues = {
    ...DEFAULT_VALUES,
    category_thresholds: parseThresholds(stored.get('category_thresholds')),
  }
  for (const key of Object.keys(DEFAULT_VALUES) as ScalarKey[]) {
    const raw = stored.get(key)
    if (
      raw === undefined ||
      key === 'openai_api_key' ||
      (key as string) === 'category_thresholds'
    ) {
      continue
    }
    const fallback = DEFAULT_VALUES[key]
    if (typeof fallback === 'boolean') {
      Object.assign(values, { [key]: raw === 'true' })
    } else if (typeof fallback === 'number') {
      const parsed = Number(raw)
      Object.assign(values, {
        [key]: Number.isFinite(parsed) ? parsed : fallback,
      })
    } else {
      Object.assign(values, { [key]: raw })
    }
  }
  if (!['off', 'observe', 'block'].includes(values.mode)) {
    values.mode = 'off'
  }
  return values
}

function serializeThresholds(thresholds: Record<string, string>): string {
  const entries = Object.entries(thresholds)
    .filter(([, value]) => value.trim() !== '')
    .map(([category, value]) => [category, Number(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(Object.fromEntries(entries))
}

/**
 * Returns the option updates needed to persist the form. Only changed fields
 * are sent; an empty API key keeps the stored key because the server never
 * returns it.
 */
export function moderationOptionUpdates(
  values: ModerationSettingsValues,
  saved: ModerationSettingsValues
): { key: string; value: string }[] {
  const updates: { key: string; value: string }[] = []
  for (const key of Object.keys(
    DEFAULT_VALUES
  ) as (keyof ModerationSettingsValues)[]) {
    if (key === 'category_thresholds') {
      const next = serializeThresholds(values.category_thresholds)
      if (next !== serializeThresholds(saved.category_thresholds)) {
        updates.push({ key: MODERATION_OPTION_PREFIX + key, value: next })
      }
      continue
    }
    if (key === 'openai_api_key') {
      if (values.openai_api_key !== '') {
        updates.push({
          key: MODERATION_OPTION_PREFIX + key,
          value: values.openai_api_key,
        })
      }
      continue
    }
    if (values[key] !== saved[key]) {
      updates.push({
        key: MODERATION_OPTION_PREFIX + key,
        value: String(values[key]),
      })
    }
  }
  return updates
}
