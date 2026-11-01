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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { TopUpBonusSettingsSection } from '../topup-bonus-settings-section'

function Fixture(props: { tiers: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <TopUpBonusSettingsSection
          defaultValues={{
            enabled: false,
            title: '',
            description: '',
            startTime: 0,
            endTime: 0,
            tiers: props.tiers,
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings(tiers = '[]') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Fixture tiers={tiers} /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('switch', { name: 'Enable top-up bonus' })
}

async function addFixedTier(
  user: ReturnType<typeof userEvent.setup>,
  minAmount: string,
  bonus: string
) {
  await user.click(screen.getByRole('button', { name: 'Add bonus tier' }))
  const dialog = await screen.findByRole('dialog')
  const amountInput = within(dialog).getByLabelText('Minimum single top-up (USD)')
  await user.clear(amountInput)
  await user.type(amountInput, minAmount)
  const bonusInput = within(dialog).getByLabelText('Bonus (USD)')
  await user.clear(bonusInput)
  await user.type(bonusInput, bonus)
  await user.click(within(dialog).getByRole('button', { name: 'Add' }))
  return dialog
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

test('enabling the campaign without tiers shows an error and saves nothing', async () => {
  const user = userEvent.setup()
  await user.click(await renderSettings())
  await user.click(screen.getByRole('button', { name: 'Save top-up bonus settings' }))

  expect(
    await screen.findByText(
      'Add at least one bonus tier before enabling the campaign'
    )
  ).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})

test('adding a tier and enabling saves the tiers before switching the campaign on', async () => {
  const user = userEvent.setup()
  const toggle = await renderSettings()
  await addFixedTier(user, '100', '5')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('table')).toHaveTextContent(/100.*free/)

  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save top-up bonus settings' }))

  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.put).mock.calls.map((call) => call[1])).toEqual([
    {
      key: 'topup_bonus_setting.tiers',
      value: JSON.stringify([{ min_amount: 100, type: 'fixed', value: 5 }]),
    },
    { key: 'topup_bonus_setting.enabled', value: 'true' },
  ])
})

test('a tier cannot reuse the minimum amount of another tier', async () => {
  const user = userEvent.setup()
  await renderSettings('[{"min_amount":100,"type":"fixed","value":5}]')
  const dialog = await addFixedTier(user, '100', '8')

  expect(
    await within(dialog).findByText('Another tier already uses this amount')
  ).toBeVisible()
})
