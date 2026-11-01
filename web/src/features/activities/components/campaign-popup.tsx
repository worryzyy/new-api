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
import { Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatCurrencyFromUSD } from '@/lib/currency'

import { useCurrentCampaign } from '../api'
import { campaignPeriod, sortTopUpBonusTiers, tierReward } from '../lib/bonus'

/** The id of the last campaign this browser has seen in the popup. */
const SEEN_KEY = 'campaign-popup-seen'

function readSeenCampaign(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

function markCampaignSeen(id: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(id))
  } catch {
    // Without storage the popup simply shows again next visit.
  }
}

/**
 * Announces a newly published campaign once per browser: the first page a
 * visitor opens shows it, and closing it in any way marks it as seen.
 */
export function CampaignPopup() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { data: campaign } = useCurrentCampaign()
  const [dismissed, setDismissed] = useState<number | null>(null)

  const id = campaign?.visible ? campaign.id : undefined
  const open =
    id !== undefined &&
    id !== dismissed &&
    readSeenCampaign() !== String(id) &&
    !pathname.startsWith('/activities')

  if (!campaign || id === undefined) return null

  const close = () => {
    markCampaignSeen(id)
    setDismissed(id)
  }
  const tiers = sortTopUpBonusTiers(campaign.tiers)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={campaign.title || t('Campaign')}
      description={campaignPeriod(campaign, t)}
      contentClassName='sm:max-w-md'
      bodyClassName='space-y-3'
      footer={
        <>
          <Button variant='outline' onClick={close}>
            {t('Got it')}
          </Button>
          <Button render={<Link to='/activities' />} onClick={close}>
            {t('View campaign')}
          </Button>
        </>
      }
    >
      <StatusBadge
        variant={campaign.active ? 'success' : 'info'}
        copyable={false}
      >
        {campaign.active ? t('In progress') : t('Starting soon')}
      </StatusBadge>
      {tiers.length > 0 ? (
        <ul className='space-y-1.5 text-sm'>
          {tiers.map((tier) => (
            <li key={tier.min_amount} className='flex justify-between gap-3'>
              <span className='text-muted-foreground'>
                {t('Single top-up of {{amount}} or more', {
                  amount: formatCurrencyFromUSD(tier.min_amount),
                })}
              </span>
              <span className='text-chart-3 font-semibold'>
                {tierReward(tier, t)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  )
}
