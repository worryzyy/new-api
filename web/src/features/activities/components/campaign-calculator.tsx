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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatCurrencyFromUSD } from '@/lib/currency'

import { sortTopUpBonusTiers, topUpBonusFor } from '../lib/bonus'
import type { TopUpBonusTier } from '../types'

/** Marks where a campaign page wants the calculator, e.g. `<div data-campaign-calculator></div>`. */
export const CALCULATOR_SLOT_SELECTOR = '[data-campaign-calculator]'
/** Elements such as tier cards that set the calculator amount when clicked. */
const AMOUNT_SELECTOR = '[data-amount]'

type CampaignCalculatorProps = {
  tiers: TopUpBonusTier[] | undefined
  /** The campaign page the calculator lives in, for its `data-amount` elements. */
  scope: ShadowRoot | Document
  /** Slider maximum in USD; defaults to one and a half times the top tier. */
  max?: number
  /** Starting amount in USD; defaults to the top tier. */
  value?: number
}

function sliderMax(tiers: TopUpBonusTier[], max?: number): number {
  if (max && max > 0) return max
  const top = tiers.at(-1)?.min_amount ?? 0
  return top > 0 ? Math.ceil((top * 1.5) / 100) * 100 : 1000
}

/**
 * A draggable top-up calculator for campaign pages. It reads the live bonus
 * tiers, so the numbers always match what the server grants. Clicking any
 * element with `data-amount` on the page moves the slider there, and the
 * element whose amount is selected gets a `data-active` attribute to style.
 */
export function CampaignCalculator(props: CampaignCalculatorProps) {
  const { t } = useTranslation()
  const tiers = sortTopUpBonusTiers(props.tiers)
  const max = sliderMax(tiers, props.max)
  const [amount, setAmount] = useState(() =>
    Math.min(props.value ?? tiers.at(-1)?.min_amount ?? 0, max)
  )
  const { scope } = props

  useEffect(() => {
    const onClick = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const raw = target.closest(AMOUNT_SELECTOR)?.getAttribute('data-amount')
      const next = Number(raw)
      if (raw && Number.isFinite(next) && next >= 0) {
        setAmount(Math.min(next, max))
      }
    }
    scope.addEventListener('click', onClick)
    return () => scope.removeEventListener('click', onClick)
  }, [scope, max])

  useEffect(() => {
    scope.querySelectorAll(AMOUNT_SELECTOR).forEach((element) => {
      const selected = Number(element.getAttribute('data-amount')) === amount
      element.toggleAttribute('data-active', selected)
      element.setAttribute('aria-pressed', String(selected))
    })
  }, [scope, amount])

  const bonus = topUpBonusFor(amount, tiers)
  const matched = tiers.findLast((tier) => amount >= tier.min_amount)
  const next = tiers.find((tier) => amount < tier.min_amount)
  const progress = max > 0 ? (amount / max) * 100 : 0

  let hint = t('Drag to choose an amount')
  if (next) {
    hint = t(
      'Add {{amount}} more to reach the {{tier}} tier: {{bonus}} bonus',
      {
        amount: formatCurrencyFromUSD(next.min_amount - amount),
        tier: formatCurrencyFromUSD(next.min_amount),
        bonus: formatCurrencyFromUSD(topUpBonusFor(next.min_amount, tiers)),
      }
    )
  } else if (matched) {
    hint = t('Top tier reached')
  }

  return (
    <div className='campaign-calc bg-card text-card-foreground grid gap-5 rounded-xl border p-5 sm:p-7 md:grid-cols-[1.5fr_1fr] md:gap-8'>
      <div className='campaign-calc-input min-w-0'>
        <div className='flex items-end justify-between gap-3'>
          <label className='text-sm font-medium' htmlFor='campaign-calc-range'>
            {t('Top-up amount')}
          </label>
          <span className='text-primary text-3xl font-bold tracking-tight tabular-nums'>
            {formatCurrencyFromUSD(amount)}
          </span>
        </div>
        <input
          id='campaign-calc-range'
          type='range'
          min={0}
          max={max}
          step={1}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className='campaign-calc-range [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background mt-5 h-2 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:shadow-md'
          style={{
            background: `linear-gradient(to right, var(--primary) ${progress}%, var(--muted) ${progress}%)`,
          }}
        />
        <div className='text-muted-foreground relative mt-3 h-4 text-xs tabular-nums'>
          <span className='absolute left-0'>{formatCurrencyFromUSD(0)}</span>
          {tiers.map((tier) => (
            <span
              key={tier.min_amount}
              className='absolute hidden -translate-x-1/2 sm:inline'
              style={{ left: `${(tier.min_amount / max) * 100}%` }}
            >
              {formatCurrencyFromUSD(tier.min_amount)}
            </span>
          ))}
          <span className='absolute right-0'>{formatCurrencyFromUSD(max)}</span>
        </div>
        <p className='campaign-calc-hint text-muted-foreground mt-5 text-sm'>
          {hint}
        </p>
      </div>

      <div className='campaign-calc-summary min-w-0 space-y-3 text-sm'>
        <div className='flex justify-between gap-3'>
          <span className='text-muted-foreground'>{t('You pay')}</span>
          <span className='font-semibold tabular-nums'>
            {formatCurrencyFromUSD(amount)}
          </span>
        </div>
        <div className='flex justify-between gap-3'>
          <span className='text-muted-foreground'>{t('Campaign bonus')}</span>
          <span className='text-primary font-semibold tabular-nums'>
            +{formatCurrencyFromUSD(bonus)}
          </span>
        </div>
        <div className='flex justify-between gap-3'>
          <span className='text-muted-foreground'>{t('Matched tier')}</span>
          <span className='font-semibold tabular-nums'>
            {matched
              ? t('{{amount}} tier', {
                  amount: formatCurrencyFromUSD(matched.min_amount),
                })
              : t('Below the lowest tier')}
          </span>
        </div>
        <div className='bg-primary/5 border-primary/15 rounded-lg border px-4 py-3'>
          <div className='text-muted-foreground text-xs'>
            {t('Total credited')}
          </div>
          <div className='text-primary mt-1 text-2xl font-bold tracking-tight tabular-nums'>
            {formatCurrencyFromUSD(amount + bonus)}
          </div>
        </div>
        <a
          href='/wallet'
          className='bg-primary text-primary-foreground hover:bg-primary/90 flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-colors'
        >
          {t('Top up now')}
        </a>
      </div>
    </div>
  )
}
