export interface TurnstilePolicy {
  readonly action: 'booking' | 'customer_access' | 'review' | 'password_recovery'
  readonly hostnames: readonly string[]
}
