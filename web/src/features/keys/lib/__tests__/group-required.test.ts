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
import type { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'

import {
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
} from '../api-key-form'

const t = ((key: string) => key) as unknown as TFunction
const values = { ...getApiKeyFormDefaultValues(false), name: 'key' }

describe('API key group requirement', () => {
  test('rejects an empty group when creating a key', () => {
    const result = getApiKeyFormSchema(t, 5, true).safeParse(values)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'group',
    ])
  })

  test('accepts a chosen group when creating a key', () => {
    const result = getApiKeyFormSchema(t, 5, true).safeParse({
      ...values,
      group: 'default',
    })

    expect(result.success).toBe(true)
  })

  test('keeps accepting a stored empty group when editing an existing key', () => {
    const result = getApiKeyFormSchema(t, 5).safeParse(values)

    expect(result.success).toBe(true)
  })
})
