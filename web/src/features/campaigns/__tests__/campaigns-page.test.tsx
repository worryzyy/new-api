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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { Campaigns } from '..'
import type { Campaign } from '../types'

const base: Omit<Campaign, 'id' | 'title' | 'status'> = {
  content: '',
  start_time: 0,
  end_time: 0,
  published_at: 0,
  ended_at: 0,
  created_at: 1,
  updated_at: 1,
  bonus_tiers: [],
}

const campaigns: Campaign[] = [
  {
    ...base,
    id: 2,
    title: 'Double 11',
    status: 'draft',
    bonus_tiers: [{ min_amount: 100, type: 'fixed', value: 5 }],
  },
  {
    ...base,
    id: 1,
    title: 'Summer sale',
    status: 'published',
    published_at: 1,
    bonus_count: 3,
    bonus_quota: 0,
  },
]

beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: campaigns },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
})

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Campaigns />
    </QueryClientProvider>
  )
}

test('the history lists every campaign and publishing one asks first', async () => {
  const user = userEvent.setup()
  renderSection()

  await screen.findByText('Double 11')
  const [, draftRow, liveRow] = screen.getAllByRole('row')
  expect(draftRow).toHaveTextContent('Draft')
  expect(liveRow).toHaveTextContent('Live')
  expect(liveRow).toHaveTextContent('3 orders')
  expect(within(liveRow).getByRole('button', { name: 'End' })).toBeVisible()

  await user.click(within(draftRow).getByRole('button', { name: 'Publish' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Double 11')
  expect(api.post).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Publish' }))

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/campaign/2/publish')
  )
})

test('a new campaign saves its title, page and bonus tiers', async () => {
  const user = userEvent.setup()
  renderSection()

  await user.click(await screen.findByRole('button', { name: 'New campaign' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(
    within(dialog).getByLabelText('Campaign title'),
    'Black Friday'
  )
  await user.click(
    within(dialog).getByRole('textbox', { name: 'Campaign page' })
  )
  await user.paste('<h1>Black Friday</h1>')

  await user.click(
    within(dialog).getByRole('button', { name: 'Add bonus tier' })
  )
  const dialogs = await screen.findAllByRole('dialog')
  const tierDialog = dialogs.at(-1)
  if (!tierDialog) throw new Error('the tier dialog did not open')
  const amount = within(tierDialog).getByLabelText(
    'Minimum single top-up (USD)'
  )
  await user.clear(amount)
  await user.type(amount, '100')
  const bonus = within(tierDialog).getByLabelText('Bonus (USD)')
  await user.clear(bonus)
  await user.type(bonus, '5')
  await user.click(within(tierDialog).getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))

  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/campaign/', {
      title: 'Black Friday',
      content: '<h1>Black Friday</h1>',
      start_time: 0,
      end_time: 0,
      bonus_tiers: [{ min_amount: 100, type: 'fixed', value: 5 }],
    })
  )
})

test('saving without a title shows an error and sends nothing', async () => {
  const user = userEvent.setup()
  renderSection()

  await user.click(await screen.findByRole('button', { name: 'New campaign' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  expect(
    await within(dialog).findByText('Enter a campaign title')
  ).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
})
