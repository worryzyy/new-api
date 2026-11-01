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
import { render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { CampaignPage } from '..'
import type { CurrentCampaign } from '../types'

vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: ReactNode }) => (
    <main data-testid='layout'>{props.children}</main>
  ),
}))

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
})

function renderPage(campaign: CurrentCampaign) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: campaign },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: CampaignPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

test('a running campaign lists its tiers in order with a link to the wallet', async () => {
  renderPage({
    visible: true,
    active: true,
    title: '双 11 充值加赠',
    tiers: [
      { min_amount: 500, type: 'percent', value: 8, max_bonus: 50 },
      { min_amount: 100, type: 'fixed', value: 5 },
    ],
  })

  expect(
    await screen.findByRole('heading', { name: '双 11 充值加赠' })
  ).toBeVisible()
  expect(screen.getByText('进行中')).toBeVisible()
  const tiers = screen.getByRole('region', { name: '加赠档位' })
  expect(tiers).toHaveTextContent(
    /单笔充值满 \$100.*送 \$5.*单笔充值满 \$500.*加赠 8%.*最多 \$50/
  )
  expect(screen.getByText('立即充值').closest('a')).toHaveAttribute(
    'href',
    '/wallet'
  )
})

test('a campaign with its own page shows the page HTML without scripts', async () => {
  renderPage({
    visible: true,
    active: true,
    title: '双 11',
    content:
      '<h1 style="color:red">双 11 狂欢</h1><script>window.pwned = true</script>',
    tiers: [{ min_amount: 100, type: 'fixed', value: 5 }],
  })

  const layout = await screen.findByTestId('layout')
  await waitFor(() =>
    expect(layout.querySelector('div')?.shadowRoot?.innerHTML).toContain(
      '双 11 狂欢'
    )
  )
  const html = layout.querySelector('div')?.shadowRoot?.innerHTML ?? ''
  expect(html).toContain('color:red')
  expect(html).not.toContain('<script')
  expect(screen.queryByText('立即充值')).toBeNull()
})

test('no visible campaign shows the empty state', async () => {
  renderPage({ visible: false, active: false })

  expect(await screen.findByText('当前没有活动')).toBeVisible()
  expect(screen.queryByText('立即充值')).toBeNull()
})
