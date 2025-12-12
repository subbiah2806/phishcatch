// Copyright 2021 Palantir Technologies
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { PasswordContent, PasswordHash, AlertTypes } from '../types'
import { getHashDataIfItExists, removeHash } from './userInfo'
import { createServerAlert } from './sendAlert'
import { getConfig } from '../config'
import { addNotitication } from './handleNotificationClick'

interface ChatGPTRequestBody {
  action: string
  messages: Array<{
    id: string
    author: { role: string }
    create_time: number
    content: {
      content_type: string
      parts: string[]
    }
    metadata: {
      selected_github_repos: string[]
      selected_all_github_repos: boolean
      serialization_metadata: { custom_symbol_offsets: unknown[] }
    }
  }>
  conversation_id?: string
  parent_message_id: string
  model: string
  timezone_offset_min: number
  timezone: string
  conversation_mode: { kind: string }
  enable_message_followups: boolean
  system_hints: string[]
  supports_buffering: boolean
  supported_encodings: string[]
  client_contextual_info: {
    is_dark_mode: boolean
    time_since_loaded: number
    page_height: number
    page_width: number
    pixel_ratio: number
    screen_height: number
    screen_width: number
    app_name: string
  }
  paragen_cot_summary_display_override: string
  force_parallel_switch: string
}

// Temp storage for new conversation messages (before conversation_id is assigned)
let pendingNewConversationMessage: string | null = null

async function handlePasswordLeak(message: PasswordContent, hashData: PasswordHash) {
  const config = await getConfig()
  const alertContent = {
    ...message,
    alertType: AlertTypes.REUSE,
    associatedHostname: hashData.hostname || '',
    associatedUsername: hashData.username || '',
  }

  void createServerAlert(alertContent)

  if (config.display_reuse_alerts) {
    const alertIconUrl = chrome.runtime.getURL('icon.png')
    const opt: chrome.notifications.NotificationOptions = {
      type: 'basic',
      title: 'PhishCatch Alert',
      message: `PhishCatch has detected enterprise password re-use on the url: ${message.url}\n`,
      iconUrl: alertIconUrl,
      requireInteraction: true,
      priority: 2,
      buttons: [{ title: 'This is a false positive' }, { title: `That wasn't my enterprise password` }],
    }

    chrome.notifications.create(opt, (id) => {
      addNotitication({ id, hash: hashData.hash, url: message.url })
    })
  }

  if (config.expire_hash_on_use) {
    await removeHash(hashData.hash)
  }
}

/**
 * Validate user message for password leaks
 * Splits message by spaces and checks each word against stored password hashes
 */
async function validateUserMessage(messageText: string, url: string): Promise<void> {
  if (!messageText || typeof messageText !== 'string') return

  const words = messageText.split(/\s+/)

  for (const word of words) {
    if (!word || word.length < 4) continue

    const hashData = await getHashDataIfItExists(word)
    if (hashData) {
      const message: PasswordContent = {
        url,
        password: word,
        referrer: '',
        timestamp: Date.now(),
        save: false,
      }

      await handlePasswordLeak(message, hashData)
    }
  }
}

/**
 * Setup ChatGPT API request interceptor using webRequest API
 */
export function setupChatGPTInterceptor(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      let body = ''

      if (details.requestBody?.raw) {
        const decoder = new TextDecoder('utf-8')
        const rawBody = details.requestBody.raw[0]?.bytes
        if (rawBody) {
          body = decoder.decode(rawBody)
        }
      } else if (details.requestBody?.formData) {
        body = JSON.stringify(details.requestBody.formData)
      }

      try {
        const parsed = JSON.parse(body) as ChatGPTRequestBody
        const conversationId = parsed.conversation_id
        const messageParts = parsed.messages?.[0]?.content?.parts || []
        const messageText = messageParts.filter((part) => typeof part === 'string').join(' ')
        const messageContent = JSON.stringify(parsed.messages?.[0]?.content)

        if (!messageContent) {
          return {}
        }

        void validateUserMessage(messageText, details.url)

        if (!conversationId) {
          pendingNewConversationMessage = messageContent
          return {}
        }

        chrome.storage.local.get('user-message-chatgpt', (data) => {
          const userMessages: Record<string, string[]> = data['user-message-chatgpt'] || {}

          chrome.storage.local.set({
            'user-message-chatgpt': {
              ...userMessages,
              [conversationId]: [...(userMessages[conversationId] || []), messageContent],
            },
          })
        })
      } catch {
        // Invalid JSON, skip saving
      }

      return {}
    },
    { urls: ['*://chatgpt.com/*/conversation'] },
    ['blocking', 'requestBody'],
  )

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const urlMatch = details.url.match(/\/conversation\/([a-f0-9-]+)\/stream_status/)
      const conversationId = urlMatch?.[1]

      if (conversationId && pendingNewConversationMessage) {
        const messageContent = pendingNewConversationMessage
        pendingNewConversationMessage = null

        chrome.storage.local.get('user-message-chatgpt', (data) => {
          const userMessages: Record<string, string[]> = data['user-message-chatgpt'] || {}

          chrome.storage.local.set({
            'user-message-chatgpt': {
              ...userMessages,
              [conversationId]: [...(userMessages[conversationId] || []), messageContent],
            },
          })
        })
      }

      return {}
    },
    { urls: ['*://chatgpt.com/*/conversation/*/stream_status'] },
    ['blocking'],
  )
}
