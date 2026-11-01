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
import { expect, test } from 'vitest'

import { topUpBonusFor } from '../lib/bonus'
import type { TopUpBonusTier } from '../types'

const tiers: TopUpBonusTier[] = [
  { min_amount: 500, type: 'percent', value: 8, max_bonus: 50 },
  { min_amount: 100, type: 'fixed', value: 5 },
  { min_amount: 1000, type: 'percent', value: 10 },
]

test.each([
  { amount: 0, bonus: 0 },
  { amount: 99, bonus: 0 },
  { amount: 100, bonus: 5 },
  { amount: 101, bonus: 5 },
  { amount: 600, bonus: 48 },
  { amount: 800, bonus: 50 },
  { amount: 1000, bonus: 100 },
  { amount: Number.NaN, bonus: 0 },
])('a $amount top-up earns a $bonus bonus from the highest tier it reaches', ({ amount, bonus }) => {
  expect(topUpBonusFor(amount, tiers)).toBe(bonus)
})

test('no tiers means no bonus', () => {
  expect(topUpBonusFor(600, undefined)).toBe(0)
  expect(topUpBonusFor(600, [])).toBe(0)
})
