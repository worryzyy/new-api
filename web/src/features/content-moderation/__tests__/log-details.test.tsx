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

import type { ModerationLog } from '../api'
import { ModerationLogDetailsDialog } from '../components/moderation-log-details-dialog'

const baseEntry: ModerationLog = {
  id: 42,
  created_at: 1760000000,
  request_id: 'req-1',
  user_id: 7,
  username: 'alice',
  user_email: '',
  token_id: 1,
  token_name: 'codex',
  group_name: 'default',
  model_name: 'gpt-5',
  endpoint: '/v1/responses',
  mode: 'observe',
  action: 'allow',
  flagged: true,
  source: 'judge',
  matched_keyword: '',
  category: 'evade risk control',
  score: 0.93,
  category_scores: '',
  threshold_snapshot: '',
  input_excerpt: 'bypass the app ban with key [redacted]',
  judge_reason: 'targets a third-party platform',
  input_hash: '',
  error: '',
  upstream_latency_ms: 900,
  queue_delay_ms: 0,
  violation_count: 0,
  auto_banned: false,
  user_status: 1,
}

function renderDetails(entry: ModerationLog) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModerationLogDetailsDialog entry={entry} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ModerationLogDetailsDialog', () => {
  it('loads and shows the full unredacted input of a flagged record', async () => {
    const user = userEvent.setup()
    const full = 'bypass the app ban with key sk-visible-12345'
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { ...baseEntry, input_full: full } },
    })
    renderDetails(baseEntry)

    await user.click(
      screen.getByRole('button', { name: baseEntry.input_excerpt })
    )

    expect(await screen.findByText(full)).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/api/content_moderation/logs/42')
    expect(screen.getByText('Full original text')).toBeInTheDocument()
    expect(
      screen.getByText('targets a third-party platform')
    ).toBeInTheDocument()
  })

  it('shows the redacted excerpt without fetching when the record passed', async () => {
    const user = userEvent.setup()
    const get = vi.spyOn(api, 'get')
    const passed = {
      ...baseEntry,
      flagged: false,
      source: 'openai',
      judge_reason: '',
    }
    renderDetails(passed)

    await user.click(screen.getByRole('button', { name: passed.input_excerpt }))

    expect(await screen.findByText('Redacted excerpt')).toBeInTheDocument()
    expect(screen.getAllByText(passed.input_excerpt).length).toBeGreaterThan(0)
    expect(get).not.toHaveBeenCalled()
  })
})
