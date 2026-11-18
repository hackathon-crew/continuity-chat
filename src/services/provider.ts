import { create } from 'zustand'
import { api, jsonBody } from './platform.js'
import { setModel } from './settings.js'

export type ProviderCapabilities = {
  thinking: boolean
  search: boolean
  attachments: boolean
  speech: boolean
}

type ProviderState = {
  name: string
  models: string[]
  selectedModel: string
  capabilities: ProviderCapabilities
  loaded: boolean
  error: string | null
}

export const useProvider = create<ProviderState>(() => ({
  name: 'DeepSeek',
  models: [],
  selectedModel: '',
  capabilities: { thinking: false, search: false, attachments: false, speech: false },
  loaded: false,
  error: null,
}))

let loading: Promise<void> | null = null

export const loadProvider = (force = false) => {
  if (loading) {
    return loading
  }
  if (!force && useProvider.getState().loaded) {
    return Promise.resolve()
  }
  useProvider.setState({ loaded: false, error: null })
  loading = api<{
    name: string
    models: string[]
    selectedModel: string
    capabilities: ProviderCapabilities
  }>('/api/provider')
    .then((result) => {
      setModel(result.selectedModel)
      useProvider.setState({ ...result, loaded: true, error: null })
    })
    .catch((error) => {
      useProvider.setState({ error: error instanceof Error ? error.message : '模型信息加载失败' })
    })
    .finally(() => {
      loading = null
    })
  return loading
}

export const selectProviderModel = async (model: string) => {
  const selected = model.trim()
  if (!selected) {
    return
  }
  await api('/api/provider/model', { method: 'PUT', body: jsonBody({ model: selected }) })
  setModel(selected)
  useProvider.setState((state) => ({
    selectedModel: selected,
    models: state.models.includes(selected) ? state.models : [...state.models, selected].sort(),
  }))
}
