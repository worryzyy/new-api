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
import { Link } from '@tanstack/react-router'
import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  sortTopUpBonusTiers,
  tierReward,
} from '@/features/activities/lib/bonus'
import type { CurrentCampaign } from '@/features/activities/types'
import { formatCurrencyFromUSD } from '@/lib/currency'

interface TopUpBonusBannerProps {
  campaign: CurrentCampaign | undefined
}

export function TopUpBonusBanner(props: TopUpBonusBannerProps) {
  const { t } = useTranslation()
  if (!props.campaign?.visible) return null
  const tiers = sortTopUpBonusTiers(props.campaign.tiers)

  return (
    <Card data-card-hover='false' className='bg-chart-3/5 py-0'>
      <CardContent className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <IconBadge tone='chart-3'>
            <Gift />
          </IconBadge>
          <div className='min-w-0'>
            <h3 className='truncate text-sm font-semibold'>
              {props.campaign.title || t('Top-up Bonus')}
            </h3>
            <p className='text-muted-foreground line-clamp-2 text-xs'>
              {props.campaign.active
                ? tiers
                    .map((tier) =>
                      t('{{amount}}+: {{reward}}', {
                        amount: formatCurrencyFromUSD(tier.min_amount),
                        reward: tierReward(tier, t),
                      })
                    )
                    .join(' · ')
                : t('Starting soon')}
            </p>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          className='shrink-0'
          render={<Link to='/activities' />}
        >
          {t('View campaign')}
        </Button>
      </CardContent>
    </Card>
  )
}
