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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ContentModeration } from '..'
import type { ModerationConfigView, ModerationStatus } from '../api'
import { ModerationSettingsDialog } from '../components/settings/moderation-settings-dialog'

const config: ModerationConfigView = {
  enabled: true,
  mode: 'pre_block',
  base_url: 'https://api.openai.com',
  model: 'omni-moderation-latest',
  api_keys: [],
  timeout_ms: 3000,
  retry_count: 2,
  sample_rate: 100,
  check_images: true,
  all_groups: true,
  groups: [],
  model_filter: { type: 'all', models: [] },
  exempt_user_ids: [],
  thresholds: { hate: 0.65 },
  worker_count: 4,
  queue_size: 32768,
  record_non_hits: false,
  pre_hash_check_enabled: true,
  block_status: 403,
  block_message: '',
  auto_ban_enabled: true,
  ban_threshold: 10,
  violation_window_hours: 720,
  blocked_keywords: ['cm-test-violation'],
  keyword_blocking_mode: 'keyword_and_api',
  hit_retention_days: 180,
  non_hit_retention_days: 3,
  api_key_configured: true,
  api_key_count: 1,
  api_key_masks: ['********OMkA'],
  api_key_statuses: [
    {
      index: 1,
      key_hash: 'a'.repeat(64),
      masked: '********OMkA',
      status: 'ok',
      configured: true,
      failure_count: 0,
      success_count: 3,
      last_error: '',
      last_checked_at: 0,
      frozen_until: 0,
      last_latency_ms: 200,
      last_http_status: 200,
      last_tested: false,
    },
  ],
}

function renderDialog() {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [] },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ModerationSettingsDialog
        open
        onOpenChange={() => undefined}
        config={config}
        status={{ redis_enabled: true } as ModerationStatus}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ContentModeration page', () => {
  it('opens the settings dialog from the header button', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      const data: Record<string, unknown> = {
        '/api/content_moderation/config': config,
        '/api/content_moderation/status': {
          mode: 'pre_block',
          api_key_count: 1,
          api_key_available_count: 1,
          api_key_loads: [],
          api_key_statuses: [],
          redis_enabled: true,
        },
        '/api/content_moderation/logs': { items: [], total: 0 },
      }
      return { data: { success: true, data: data[url] ?? [] } }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ContentModeration />
      </QueryClientProvider>
    )

    const button = await screen.findByRole('button', {
      name: 'Content audit settings',
    })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(
      await screen.findByRole('dialog', { name: 'Content audit settings' })
    ).toBeInTheDocument()
  })
})

describe('ModerationSettingsDialog', () => {
  it('opens on the basic tab with the saved key listed', async () => {
    renderDialog()

    expect(
      await screen.findByRole('dialog', { name: 'Content audit settings' })
    ).toBeInTheDocument()
    expect(screen.getByText('********OMkA')).toBeInTheDocument()
  })

  it('switches to every tab without crashing', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByRole('dialog', { name: 'Content audit settings' })

    for (const name of [
      'Audit scope',
      'Run queue',
      'Hit handling',
      'Risk thresholds',
      'Keyword blocking',
      'Log retention',
    ]) {
      await user.click(screen.getByRole('tab', { name }))
      expect(screen.getByRole('tab', { name })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    }
  })
})
