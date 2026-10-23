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

import {
  moderationOptionUpdates,
  moderationSettingsSchema,
  moderationValuesFromOptions,
} from '../lib/settings-form'

const prefix = 'content_moderation_setting.'

describe('moderationValuesFromOptions', () => {
  it('uses server defaults when no moderation option is stored', () => {
    const values = moderationValuesFromOptions([])

    expect(values.mode).toBe('off')
    expect(values.openai_model).toBe('omni-moderation-latest')
    expect(values.auto_ban_threshold).toBe(10)
    expect(values.category_thresholds.violence).toBe('')
  })

  it('parses stored scalars and thresholds and ignores unknown modes', () => {
    const values = moderationValuesFromOptions([
      { key: `${prefix}mode`, value: 'unexpected' },
      { key: `${prefix}auto_ban_enabled`, value: 'true' },
      { key: `${prefix}auto_ban_threshold`, value: '3' },
      { key: `${prefix}category_thresholds`, value: '{"sexual":0.5,"hate":0}' },
      { key: 'SensitiveWords', value: 'unrelated' },
    ])

    expect(values.mode).toBe('off')
    expect(values.auto_ban_enabled).toBe(true)
    expect(values.auto_ban_threshold).toBe(3)
    expect(values.category_thresholds.sexual).toBe('0.5')
    expect(values.category_thresholds.hate).toBe('')
  })
})

describe('moderationOptionUpdates', () => {
  it('sends only changed fields and keeps the stored API key when blank', () => {
    const saved = moderationValuesFromOptions([])
    const values = {
      ...saved,
      mode: 'block' as const,
      category_thresholds: { ...saved.category_thresholds, violence: '0.7' },
    }

    expect(moderationOptionUpdates(values, saved)).toEqual([
      { key: `${prefix}mode`, value: 'block' },
      { key: `${prefix}category_thresholds`, value: '{"violence":0.7}' },
    ])
  })

  it('sends a newly entered API key', () => {
    const saved = moderationValuesFromOptions([])

    expect(
      moderationOptionUpdates({ ...saved, openai_api_key: 'sk-test' }, saved)
    ).toEqual([{ key: `${prefix}openai_api_key`, value: 'sk-test' }])
  })
})

describe('moderationSettingsSchema', () => {
  it('rejects thresholds outside (0, 1]', () => {
    const values = moderationValuesFromOptions([])
    const result = moderationSettingsSchema.safeParse({
      ...values,
      category_thresholds: { ...values.category_thresholds, hate: '1.5' },
    })

    expect(result.success).toBe(false)
  })
})
