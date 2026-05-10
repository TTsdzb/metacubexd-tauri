import type { Log, MemoryData, TrafficData, WsMsg } from '~/types'
import TauriWebSocket from '@tauri-apps/plugin-websocket'
import { getCurrentScope, onScopeDispose } from 'vue'
import { useMockMode } from './useApi'
import { useMockData } from './useMockData'

export function useBackendWebSocket() {
  const endpointStore = useEndpointStore()
  const connectionsStore = useConnectionsStore()
  const globalStore = useGlobalStore()
  const logsStore = useLogsStore()
  const configStore = useConfigStore()

  // WebSocket connections
  let connectionsWs: { ws: TauriWebSocket; removeListener: () => void } | null =
    null
  let trafficWs: { ws: TauriWebSocket; removeListener: () => void } | null =
    null
  let memoryWs: { ws: TauriWebSocket; removeListener: () => void } | null = null
  let logsWs: { ws: TauriWebSocket; removeListener: () => void } | null = null

  // Mock mode intervals
  let mockInterval: ReturnType<typeof setInterval> | null = null

  const createWebSocket = async (
    path: string,
    onMessage: (data: unknown) => void,
  ) => {
    const endpoint = endpointStore.currentEndpoint
    if (!endpoint) return null

    const wsUrl = endpointStore.wsEndpointURL
    const secret = endpoint.secret

    const params = new URLSearchParams()
    if (secret) params.set('token', secret)

    const ws = await TauriWebSocket.connect(
      `${wsUrl}/${path}?${params.toString()}`,
    )

    const removeListener = ws.addListener((msg) => {
      if (msg.type !== 'Text') return
      try {
        const data = JSON.parse(msg.data)
        onMessage(data)
      } catch {
        // Ignore parse errors
      }
    })

    return { ws, removeListener }
  }

  // Connect to all WebSocket endpoints
  const connect = () => {
    disconnect()

    // In mock mode, use mock data instead of WebSocket
    if (useMockMode()) {
      const mockData = useMockData()

      // Immediately populate stores with mock data
      connectionsStore.updateFromWsMsg({
        connections: mockData.mockConnections,
        uploadTotal: mockData.mockTrafficStats.up,
        downloadTotal: mockData.mockTrafficStats.down,
      } as WsMsg)

      globalStore.setLatestTraffic(mockData.mockTrafficStats as TrafficData)
      globalStore.setLatestMemory(mockData.mockMemory as MemoryData)

      // Add initial chart data points for traffic, memory, and connections
      const now = Date.now()
      const baseConnectionCount = mockData.mockConnections.length
      for (let i = 30; i >= 0; i--) {
        const time = now - i * 1000
        const trafficDown =
          mockData.mockTrafficStats.down +
          Math.floor(Math.random() * 100000) -
          50000
        const trafficUp =
          mockData.mockTrafficStats.up +
          Math.floor(Math.random() * 20000) -
          10000
        const memoryValue =
          mockData.mockMemory.inuse +
          Math.floor(Math.random() * 5000000) -
          2500000
        // Simulate connection count fluctuation
        const connectionCount =
          baseConnectionCount + Math.floor(Math.random() * 10) - 5
        globalStore.addTrafficDataPoint(time, trafficDown, trafficUp)
        globalStore.addMemoryDataPoint(time, memoryValue)
        globalStore.addConnectionCountDataPoint(time, connectionCount)
      }

      // Add mock logs
      mockData.mockLogs.forEach((log) => {
        logsStore.addLog(log as Log)
      })

      // Simulate periodic updates for traffic/memory/connections
      mockInterval = setInterval(() => {
        const time = Date.now()
        // Simulate traffic fluctuation
        const trafficVariation = {
          up: mockData.mockTrafficStats.up + Math.floor(Math.random() * 10000),
          down:
            mockData.mockTrafficStats.down + Math.floor(Math.random() * 50000),
        }
        globalStore.setLatestTraffic(trafficVariation as TrafficData)
        globalStore.addTrafficDataPoint(
          time,
          trafficVariation.down,
          trafficVariation.up,
        )

        // Simulate memory fluctuation
        const memoryVariation = {
          inuse:
            mockData.mockMemory.inuse +
            Math.floor(Math.random() * 5000000) -
            2500000,
          oslimit: mockData.mockMemory.oslimit,
        }
        globalStore.setLatestMemory(memoryVariation as MemoryData)
        globalStore.addMemoryDataPoint(time, memoryVariation.inuse)

        // Simulate connection count fluctuation
        const connectionCount =
          mockData.mockConnections.length + Math.floor(Math.random() * 10) - 5
        globalStore.addConnectionCountDataPoint(time, connectionCount)
      }, 1000)

      return
    }

    // Connections WebSocket
    createWebSocket('connections', (data: unknown) => {
      const wsMsg = data as WsMsg
      connectionsStore.updateFromWsMsg(wsMsg)
      // Add data point for connection count history
      if (wsMsg) {
        const connectionCount = wsMsg.connections?.length ?? 0
        globalStore.addConnectionCountDataPoint(Date.now(), connectionCount)
      }
    }).then((ws) => {
      connectionsWs = ws
    })

    // Traffic WebSocket
    createWebSocket('traffic', (data: unknown) => {
      const trafficData = data as TrafficData
      globalStore.setLatestTraffic(trafficData)
      // Add data point for chart history
      globalStore.addTrafficDataPoint(
        Date.now(),
        trafficData.down,
        trafficData.up,
      )
    }).then((ws) => {
      trafficWs = ws
    })

    // Memory WebSocket
    createWebSocket('memory', (data: unknown) => {
      const memoryData = data as MemoryData
      globalStore.setLatestMemory(memoryData)
      // Add data point for chart history
      globalStore.addMemoryDataPoint(Date.now(), memoryData.inuse)
    }).then((ws) => {
      memoryWs = ws
    })

    // Logs WebSocket
    createLogsWebSocket().then((ws) => {
      logsWs = ws
    })
  }

  // Disconnect all WebSockets
  const disconnect = () => {
    // Clear mock interval if in mock mode
    if (mockInterval) {
      clearInterval(mockInterval)
      mockInterval = null
    }

    connectionsWs?.removeListener()
    connectionsWs?.ws.disconnect()
    trafficWs?.removeListener()
    trafficWs?.ws.disconnect()
    memoryWs?.removeListener()
    memoryWs?.ws.disconnect()
    logsWs?.removeListener()
    logsWs?.ws.disconnect()

    connectionsWs = null
    trafficWs = null
    memoryWs = null
    logsWs = null
  }

  // Helper: create logs WebSocket
  const createLogsWebSocket = async () => {
    const endpoint = endpointStore.currentEndpoint
    if (!endpoint) return null

    const wsUrl = endpointStore.wsEndpointURL
    const params = new URLSearchParams()
    if (endpoint.secret) params.set('token', endpoint.secret)
    params.set('level', configStore.logLevel)

    const ws = await TauriWebSocket.connect(
      `${wsUrl}/logs?${params.toString()}`,
    )
    const removeListener = ws.addListener((msg) => {
      if (msg.type !== 'Text') return
      try {
        const data = JSON.parse(msg.data) as Log
        logsStore.addLog(data)
      } catch {
        // Ignore parse errors
      }
    })

    return { ws, removeListener }
  }

  // Reconnect (e.g., when log level changes)
  const reconnectLogs = () => {
    logsWs?.removeListener()
    logsWs?.ws.disconnect()
    if (useMockMode()) {
      logsWs = null
      return
    }
    createLogsWebSocket().then((ws) => {
      logsWs = ws
    })
  }

  if (getCurrentScope()) {
    onScopeDispose(disconnect)
  }

  return {
    connect,
    disconnect,
    reconnectLogs,
  }
}
