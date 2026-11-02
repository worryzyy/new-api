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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { CampaignCalculator } from '../components/campaign-calculator'
import type { TopUpBonusTier } from '../types'

const tiers: TopUpBonusTier[] = [
  { min_amount: 500, type: 'fixed', value: 55 },
  { min_amount: 100, type: 'fixed', value: 11 },
  { min_amount: 1000, type: 'percent', value: 10, max_bonus: 150 },
]

function totals() {
  const summary = document.querySelector('.campaign-calc-summary')
  return summary?.textContent ?? ''
}

test('the calculator starts at the top tier and follows the slider', () => {
  render(<CampaignCalculator tiers={tiers} scope={document} />)

  const slider = screen.getByRole('slider')
  expect(slider).toHaveAttribute('max', '1500')
  expect(slider).toHaveValue('1000')
  expect(totals()).toContain('+$100')
  expect(totals()).toContain('$1,100')

  fireEvent.change(slider, { target: { value: '800' } })
  expect(totals()).toContain('+$55')
  expect(totals()).toContain('$855')
  expect(document.querySelector('.campaign-calc-hint')).toHaveTextContent(
    '$200'
  )

  fireEvent.change(slider, { target: { value: '1500' } })
  expect(totals()).toContain('+$150')

  fireEvent.change(slider, { target: { value: '50' } })
  expect(totals()).toContain('+$0')
})

test('page elements with data-amount move the slider and get marked active', async () => {
  const user = userEvent.setup()
  render(
    <>
      <button type='button' data-amount='100'>
        tier 100
      </button>
      <button type='button' data-amount='500'>
        tier 500
      </button>
      <CampaignCalculator tiers={tiers} scope={document} max={3000} />
    </>
  )

  const slider = screen.getByRole('slider')
  expect(slider).toHaveAttribute('max', '3000')
  await user.click(screen.getByRole('button', { name: 'tier 500' }))
  expect(slider).toHaveValue('500')
  expect(screen.getByRole('button', { name: 'tier 500' })).toHaveAttribute(
    'data-active'
  )
  expect(screen.getByRole('button', { name: 'tier 100' })).not.toHaveAttribute(
    'data-active'
  )
  expect(totals()).toContain('+$55')
})
