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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CampaignPopup } from '../components/campaign-popup'
import type { CurrentCampaign } from '../types'

const live: CurrentCampaign = {
  visible: true,
  active: true,
  id: 7,
  title: 'Double 11',
  tiers: [{ min_amount: 100, type: 'fixed', value: 5 }],
}

beforeEach(() => {
  localStorage.clear()
})

function renderAt(path: string, campaign: CurrentCampaign) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: campaign },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <CampaignPopup />
      </>
    ),
  })
  const page = (routePath: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: () => <main>{routePath}</main>,
    })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page('/'), page('/activities')]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('a published campaign pops up once and stays closed after dismissal', async () => {
  const user = userEvent.setup()
  renderAt('/', live)

  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('Double 11')
  expect(dialog).toHaveTextContent('Get $5 free')
  await user.click(screen.getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(localStorage.getItem('campaign-popup-seen')).toBe('7')

  cleanup()
  renderAt('/', live)
  await screen.findByText('/')
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a newer campaign pops up again', async () => {
  localStorage.setItem('campaign-popup-seen', '6')
  renderAt('/', live)

  expect(await screen.findByRole('dialog')).toHaveTextContent('Double 11')
})

test('the campaign page itself and hidden campaigns show no popup', async () => {
  renderAt('/activities', live)
  await screen.findByText('/activities')
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()

  cleanup()
  renderAt('/', { visible: false, active: false })
  await screen.findByText('/')
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()
})
