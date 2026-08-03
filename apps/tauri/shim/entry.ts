import { install } from './index'

install(globalThis, globalThis.location?.origin ?? '')
