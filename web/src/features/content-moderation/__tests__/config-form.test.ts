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
import { describe, expect, it } from 'vitest'

import type { ModerationConfigView } from '../api'
import {
  buildConfigUpdate,
  formValuesFromConfig,
  moderationFormSchema,
} from '../lib/config-form'

const savedConfig: ModerationConfigView = {
  enabled: true,
  mode: 'pre_block',
  base_url: 'https://api.openai.com',
  model: 'omni-moderation-latest',
  api_keys: [],
  timeout_ms: 3000,
  retry_count: 2,
  sample_rate: 100,
  check_images: true,
  all_groups: false,
  groups: ['vip'],
  model_filter: { type: 'exclude', models: ['gpt-4o-mini'] },
  exempt_user_ids: [7, 9],
  thresholds: { hate: 0.65, violence: 0.955 },
  worker_count: 4,
  queue_size: 32768,
  record_non_hits: false,
  pre_hash_check_enabled: true,
  block_status: 403,
  block_message: '',
  auto_ban_enabled: true,
  ban_threshold: 10,
  violation_window_hours: 720,
  blocked_keywords: ['alpha', 'beta'],
  keyword_blocking_mode: 'keyword_and_api',
  hit_retention_days: 180,
  non_hit_retention_days: 3,
  cyber_policy_exclude_from_ban_count: false,
  cyber_session_block_enabled: true,
  cyber_session_block_ttl_seconds: 3600,
  judge_enabled: true,
  judge_mode: 'observe',
  judge_base_url: 'https://api.deepseek.com',
  judge_model: 'deepseek-chat',
  judge_api_keys: [],
  judge_timeout_ms: 8000,
  judge_rules: 'saved rules',
  judge_threshold: 0.8,
  judge_count_toward_ban: false,
  judge_api_key_statuses: [],
  judge_default_rules: 'default rules',
  api_key_configured: true,
  api_key_count: 1,
  api_key_masks: ['********OMkA'],
  api_key_statuses: [],
}

describe('formValuesFromConfig', () => {
  it('shows thresholds as percentages and lists as editable text', () => {
    const values = formValuesFromConfig(savedConfig)

    expect(values.thresholds.violence).toBe(95.5)
    expect(values.thresholds['self-harm/intent']).toBe(85)
    expect(values.blocked_keywords).toBe('alpha\nbeta')
    expect(values.exempt_user_ids).toBe('7, 9')
    expect(values.new_api_keys).toBe('')
  })
})

describe('buildConfigUpdate', () => {
  it('round-trips saved values without sending stored keys', () => {
    const update = buildConfigUpdate(formValuesFromConfig(savedConfig))

    expect(update.api_keys).toEqual([])
    expect(update.api_keys_mode).toBe('append')
    expect(update.thresholds.violence).toBe(0.955)
    expect(update.thresholds.hate).toBe(0.65)
    expect(update.groups).toEqual(['vip'])
    expect(update.exempt_user_ids).toEqual([7, 9])
    expect(update.blocked_keywords).toEqual(['alpha', 'beta'])
    expect(update.cyber_session_block_enabled).toBe(true)
    expect(update.cyber_session_block_ttl_seconds).toBe(3600)
  })

  it('shows the judge threshold as a percentage and keeps saved judge keys unless new ones are entered', () => {
    const values = formValuesFromConfig(savedConfig)
    expect(values.judge_threshold).toBe(80)

    const kept = buildConfigUpdate(values)
    expect(kept.judge_threshold).toBe(0.8)
    expect(kept.judge_api_keys).toEqual([])
    expect(kept.clear_judge_api_keys).toBe(false)
    expect(kept.judge_rules).toBe('saved rules')

    const replaced = buildConfigUpdate({
      ...values,
      judge_new_api_keys: ' sk-judge \n',
    })
    expect(replaced.judge_api_keys).toEqual(['sk-judge'])
  })

  it('sends new keys and drops scope lists that do not apply', () => {
    const values = {
      ...formValuesFromConfig(savedConfig),
      new_api_keys: ' sk-one \n\nsk-two',
      all_groups: true,
      model_filter_type: 'all' as const,
    }

    const update = buildConfigUpdate(values)

    expect(update.api_keys).toEqual(['sk-one', 'sk-two'])
    expect(update.groups).toEqual([])
    expect(update.model_filter).toEqual({ type: 'all', models: [] })
  })
})

describe('moderationFormSchema', () => {
  it('rejects a model filter without models and selected groups without groups', () => {
    const result = moderationFormSchema.safeParse({
      ...formValuesFromConfig(savedConfig),
      groups: [],
      model_filter_models: [],
    })

    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(
      expect.arrayContaining(['groups', 'model_filter_models'])
    )
  })

  it('rejects a judge threshold outside 1-100 and over-long judge rules', () => {
    const result = moderationFormSchema.safeParse({
      ...formValuesFromConfig(savedConfig),
      judge_threshold: 0,
      judge_rules: 'x'.repeat(8001),
    })

    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(
      expect.arrayContaining(['judge_threshold', 'judge_rules'])
    )
  })

  it('rejects block status outside 400-599 and non-numeric user IDs', () => {
    const result = moderationFormSchema.safeParse({
      ...formValuesFromConfig(savedConfig),
      block_status: 302,
      exempt_user_ids: '7, abc',
    })

    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(
      expect.arrayContaining(['block_status', 'exempt_user_ids'])
    )
  })
})
