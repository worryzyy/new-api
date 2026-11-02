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
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { SystemStatus } from '../../types'
import { OAuthProviders } from '../oauth-providers'

vi.mock('../../hooks/use-oauth-login', () => ({
  useOAuthLogin: () => ({ isLoading: false, handleCustomOAuthLogin: vi.fn() }),
}))

function provider(id: number, name: string, icon: string) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    icon,
    client_id: 'client',
    authorization_endpoint: 'https://example.com/auth',
    scopes: 'openid',
  }
}

test('custom OAuth providers show a brand icon or an image URL', () => {
  const status = {
    custom_oauth_providers: [
      provider(1, 'Google', ' Google '),
      provider(2, 'Corp', 'https://example.com/logo.png'),
      provider(3, 'Plain', 'unknown-brand'),
    ],
  } as SystemStatus
  render(<OAuthProviders status={status} />)

  const google = screen.getByRole('button', { name: /Google/ })
  expect(google.querySelector('svg title')).toHaveTextContent('Google')
  const corp = screen.getByRole('button', { name: /Corp/ })
  expect(corp.querySelector('img')).toHaveAttribute(
    'src',
    'https://example.com/logo.png'
  )
  const plain = screen.getByRole('button', { name: /Plain/ })
  expect(plain.querySelector('svg, img')).toBeNull()
})
