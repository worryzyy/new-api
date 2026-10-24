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

import type { ModerationConfigUpdate, ModerationConfigView } from '../api'

export const MODERATION_CATEGORIES: { name: string; threshold: number }[] = [
  { name: 'harassment', threshold: 0.98 },
  { name: 'harassment/threatening', threshold: 0.9 },
  { name: 'hate', threshold: 0.65 },
  { name: 'hate/threatening', threshold: 0.65 },
  { name: 'illicit', threshold: 0.95 },
  { name: 'illicit/violent', threshold: 0.95 },
  { name: 'self-harm', threshold: 0.65 },
  { name: 'self-harm/intent', threshold: 0.85 },
  { name: 'self-harm/instructions', threshold: 0.65 },
  { name: 'sexual', threshold: 0.65 },
  { name: 'sexual/minors', threshold: 0.65 },
  { name: 'violence', threshold: 0.95 },
  { name: 'violence/graphic', threshold: 0.95 },
]

export const MAX_BLOCKED_KEYWORDS = 10000

const integer = (min: number, max: number) => z.number().int().min(min).max(max)

export const moderationFormSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['off', 'observe', 'pre_block']),
    base_url: z.string().trim().url(),
    model: z.string().trim().min(1),
    timeout_ms: integer(500, 30000),
    retry_count: integer(0, 5),
    sample_rate: integer(0, 100),
    check_images: z.boolean(),
    api_keys_mode: z.enum(['append', 'replace']),
    new_api_keys: z.string(),
    delete_api_key_hashes: z.array(z.string()),
    clear_api_keys: z.boolean(),
    all_groups: z.boolean(),
    groups: z.array(z.string()),
    model_filter_type: z.enum(['all', 'include', 'exclude']),
    model_filter_models: z.array(z.string()),
    exempt_user_ids: z
      .string()
      .refine((value) => splitList(value).every((item) => /^\d+$/.test(item)), {
        message: 'Enter user IDs separated by commas',
      }),
    // Percentages 0-100, stored on the server as 0-1.
    thresholds: z.record(z.string(), z.number().min(0).max(100)),
    worker_count: integer(1, 32),
    queue_size: integer(100, 100000),
    record_non_hits: z.boolean(),
    pre_hash_check_enabled: z.boolean(),
    block_status: integer(400, 599),
    block_message: z.string().max(500),
    auto_ban_enabled: z.boolean(),
    ban_threshold: integer(1, 1000),
    violation_window_hours: integer(1, 8760),
    blocked_keywords: z.string(),
    keyword_blocking_mode: z.enum([
      'keyword_and_api',
      'keyword_only',
      'api_only',
    ]),
    hit_retention_days: integer(1, 3650),
    non_hit_retention_days: integer(1, 3),
    cyber_policy_exclude_from_ban_count: z.boolean(),
    cyber_session_block_enabled: z.boolean(),
    cyber_session_block_ttl_seconds: integer(1, 2592000),
  })
  .superRefine((values, context) => {
    if (!values.all_groups && values.groups.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'Select at least one group or audit all groups',
      })
    }
    if (
      values.model_filter_type !== 'all' &&
      values.model_filter_models.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['model_filter_models'],
        message: 'Select at least one model for the model filter',
      })
    }
    if (splitLines(values.blocked_keywords).length > MAX_BLOCKED_KEYWORDS) {
      context.addIssue({
        code: 'custom',
        path: ['blocked_keywords'],
        message: 'Too many blocked keywords or a keyword is too long',
      })
    }
  })

export type ModerationFormValues = z.infer<typeof moderationFormSchema>

export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toPercent(value: number): number {
  return Math.round(value * 1000) / 10
}

export function defaultThresholdPercents(): Record<string, number> {
  return Object.fromEntries(
    MODERATION_CATEGORIES.map((category) => [
      category.name,
      toPercent(category.threshold),
    ])
  )
}

export function formValuesFromConfig(
  config: ModerationConfigView
): ModerationFormValues {
  const thresholds = defaultThresholdPercents()
  for (const [category, value] of Object.entries(config.thresholds ?? {})) {
    if (category in thresholds) thresholds[category] = toPercent(value)
  }
  return {
    enabled: config.enabled,
    mode: config.mode,
    base_url: config.base_url,
    model: config.model,
    timeout_ms: config.timeout_ms,
    retry_count: config.retry_count,
    sample_rate: config.sample_rate,
    check_images: config.check_images,
    api_keys_mode: 'append',
    new_api_keys: '',
    delete_api_key_hashes: [],
    clear_api_keys: false,
    all_groups: config.all_groups,
    groups: config.groups ?? [],
    model_filter_type: config.model_filter?.type ?? 'all',
    model_filter_models: config.model_filter?.models ?? [],
    exempt_user_ids: (config.exempt_user_ids ?? []).join(', '),
    thresholds,
    worker_count: config.worker_count,
    queue_size: config.queue_size,
    record_non_hits: config.record_non_hits,
    pre_hash_check_enabled: config.pre_hash_check_enabled,
    block_status: config.block_status,
    block_message: config.block_message ?? '',
    auto_ban_enabled: config.auto_ban_enabled,
    ban_threshold: config.ban_threshold,
    violation_window_hours: config.violation_window_hours,
    blocked_keywords: (config.blocked_keywords ?? []).join('\n'),
    keyword_blocking_mode: config.keyword_blocking_mode,
    hit_retention_days: config.hit_retention_days,
    non_hit_retention_days: config.non_hit_retention_days,
    cyber_policy_exclude_from_ban_count:
      config.cyber_policy_exclude_from_ban_count ?? false,
    cyber_session_block_enabled: config.cyber_session_block_enabled ?? false,
    cyber_session_block_ttl_seconds:
      config.cyber_session_block_ttl_seconds || 3600,
  }
}

/**
 * Builds the full config update. Keys are only sent when newly entered; the
 * server keeps, appends, replaces or deletes stored keys from the key fields.
 */
export function buildConfigUpdate(
  values: ModerationFormValues
): ModerationConfigUpdate {
  return {
    enabled: values.enabled,
    mode: values.mode,
    base_url: values.base_url.trim(),
    model: values.model.trim(),
    api_keys: splitLines(values.new_api_keys),
    api_keys_mode: values.api_keys_mode,
    delete_api_key_hashes: values.delete_api_key_hashes,
    clear_api_keys: values.clear_api_keys,
    timeout_ms: values.timeout_ms,
    retry_count: values.retry_count,
    sample_rate: values.sample_rate,
    check_images: values.check_images,
    all_groups: values.all_groups,
    groups: values.all_groups ? [] : values.groups,
    model_filter: {
      type: values.model_filter_type,
      models:
        values.model_filter_type === 'all' ? [] : values.model_filter_models,
    },
    exempt_user_ids: splitList(values.exempt_user_ids).map(Number),
    thresholds: Object.fromEntries(
      Object.entries(values.thresholds).map(([category, percent]) => [
        category,
        Math.round(percent * 10) / 1000,
      ])
    ),
    worker_count: values.worker_count,
    queue_size: values.queue_size,
    record_non_hits: values.record_non_hits,
    pre_hash_check_enabled: values.pre_hash_check_enabled,
    block_status: values.block_status,
    block_message: values.block_message.trim(),
    auto_ban_enabled: values.auto_ban_enabled,
    ban_threshold: values.ban_threshold,
    violation_window_hours: values.violation_window_hours,
    blocked_keywords: splitLines(values.blocked_keywords),
    keyword_blocking_mode: values.keyword_blocking_mode,
    hit_retention_days: values.hit_retention_days,
    non_hit_retention_days: values.non_hit_retention_days,
    cyber_policy_exclude_from_ban_count:
      values.cyber_policy_exclude_from_ban_count,
    cyber_session_block_enabled: values.cyber_session_block_enabled,
    cyber_session_block_ttl_seconds: values.cyber_session_block_ttl_seconds,
  }
}
