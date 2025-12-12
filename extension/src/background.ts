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

import { getConfig } from './config'
import {
  PageMessage,
  UsernameContent,
  PasswordContent,
  DomstringContent,
  PasswordHandlingReturnValue,
  DomainType,
  AlertTypes,
  PasswordHash,
} from './types'
import {
  hashAndSavePassword as hashAndSavePassword,
  saveUsername,
  getHashDataIfItExists,
  removeHash,
} from './lib/userInfo'
import { checkDOMHash, saveDOMHash } from './lib/domhash'
import { showCheckmarkIfEnterpriseDomain } from './lib/showCheckmarkIfEnterpriseDomain'
import { createServerAlert } from './lib/sendAlert'
import { getDomainType } from './lib/getDomainType'
import { getHostFromUrl } from './lib/getHostFromUrl'
import { timedCleanup } from './lib/timedCleanup'
import { addNotitication, handleNotificationClick } from './lib/handleNotificationClick'

export async function receiveMessage(message: PageMessage): Promise<void> {
  console.log('[ChatGPT Logger] receiveMessage', message)
  switch (message.msgtype) {
    case 'debug': {
      break
    }
    case 'username': {
      const content = <UsernameContent>message.content

      if ((await getDomainType(getHostFromUrl(content.url))) === DomainType.ENTERPRISE) {
        void saveUsername(content.username)
        void saveDOMHash(content.dom, content.url)
      }
      break
    }
    case 'password': {
      const content = <PasswordContent>message.content
      console.log('[ChatGPT Logger] password content', content)
      if (content.password) {
        void handlePasswordEntry(content)
      }
      break
    }
    case 'domstring': {
      const content = <DomstringContent>message.content
      void checkDOMHash(content.dom, content.url)
      break
    }
  }
}

//check if the site the password was entered into is a corporate site
export async function handlePasswordEntry(message: PasswordContent) {
  const url = message.url
  const host = getHostFromUrl(url)
  const password = message.password

  if ((await getDomainType(host)) === DomainType.ENTERPRISE) {
    if (message.save) {
      await hashAndSavePassword(password, message.username, host)
      return PasswordHandlingReturnValue.EnterpriseSave
    }
    return PasswordHandlingReturnValue.EnterpriseNoSave
  } else if ((await getDomainType(host)) === DomainType.DANGEROUS) {
    const hashData = await getHashDataIfItExists(password)
    if (hashData) {
      await handlePasswordLeak(message, hashData)
      return PasswordHandlingReturnValue.ReuseAlert
    }
  } else {
    return PasswordHandlingReturnValue.IgnoredDomain
  }

  return PasswordHandlingReturnValue.NoReuse
}

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
    // Iconurl: https://www.flaticon.com/free-icon/hacker_1995788?term=phish&page=1&position=49
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

/**
 * Validate user message for password leaks
 * Splits message by spaces and checks each word against stored password hashes
 */
async function validateUserMessage(messageText: string, url: string): Promise<void> {
  if (!messageText || typeof messageText !== 'string') return

  // Split by whitespace and check each word
  const words = messageText.split(/\s+/)

  for (const word of words) {
    // Skip empty strings and very short words (unlikely to be passwords)
    if (!word || word.length < 4) continue

    const hashData = await getHashDataIfItExists(word)
    if (hashData) {
      console.log('[ChatGPT Logger] Password detected in message!')

      const message: PasswordContent = {
        url,
        password: word,
        referrer: '',
        timestamp: Date.now(),
        save: false,
      }

      await handlePasswordLeak(message, hashData)
      // Don't return early - check all words for multiple password leaks
    }
  }
}

/**
 * Setup ChatGPT API request interceptor using webRequest API
 */
function setupChatGPTInterceptor(): void {
  // Listen for conversation requests
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

      // Parse the body to extract conversation ID and user message content
      try {
        const parsed = JSON.parse(body) as ChatGPTRequestBody
        const conversationId = parsed.conversation_id
        // Extract plain text from message parts
        const messageParts = parsed.messages?.[0]?.content?.parts || []
        const messageText = messageParts.filter((part) => typeof part === 'string').join(' ')
        const messageContent = JSON.stringify(parsed.messages?.[0]?.content)

        if (!messageContent) {
          return {}
        }

        // Validate the message for password leaks
        void validateUserMessage(messageText, details.url)

        // If no conversation ID, this is a new conversation - store temporarily
        if (!conversationId) {
          pendingNewConversationMessage = messageContent
          console.log('[ChatGPT Logger] Stored pending message for new conversation')
          return {}
        }

        // Save to local storage with conversation ID as key, appending to existing messages
        chrome.storage.local.get('user-message-chatgpt', (data) => {
          const userMessages: Record<string, string[]> = data['user-message-chatgpt'] || {}

          chrome.storage.local.set({
            'user-message-chatgpt': {
              ...userMessages,
              [conversationId]: [...(userMessages[conversationId] || []), messageContent],
            },
          })
          console.log('[ChatGPT Logger] Saved user message for conversation:', conversationId)
        })
      } catch {
        // Invalid JSON, skip saving
      }

      return {}
    },
    { urls: ['*://chatgpt.com/*/conversation'] },
    ['blocking', 'requestBody'],
  )

  // Listen for stream_status requests to get conversation ID for new conversations
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      // Extract conversation ID from stream_status URL
      const urlMatch = details.url.match(/\/conversation\/([a-f0-9-]+)\/stream_status/)
      const conversationId = urlMatch?.[1]

      if (conversationId && pendingNewConversationMessage) {
        const messageContent = pendingNewConversationMessage
        pendingNewConversationMessage = null

        // Save the pending message with the new conversation ID
        chrome.storage.local.get('user-message-chatgpt', (data) => {
          const userMessages: Record<string, string[]> = data['user-message-chatgpt'] || {}

          chrome.storage.local.set({
            'user-message-chatgpt': {
              ...userMessages,
              [conversationId]: [...(userMessages[conversationId] || []), messageContent],
            },
          })
          console.log('[ChatGPT Logger] Saved pending message for new conversation:', conversationId)
        })
      }

      return {}
    },
    { urls: ['*://chatgpt.com/*/conversation/*/stream_status'] },
    ['blocking'],
  )

  console.log('[ChatGPT Logger] webRequest interceptor set up')
}

function setup() {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  chrome.runtime.onMessage.addListener(receiveMessage)
  chrome.notifications.onButtonClicked.addListener(handleNotificationClick)

  void showCheckmarkIfEnterpriseDomain()
  timedCleanup()

  // Setup ChatGPT interceptor
  setupChatGPTInterceptor()
}

setup()
