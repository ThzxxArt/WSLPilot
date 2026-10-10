import { describe, it, expect } from 'vitest'
import type { NetworkStatus, PortForwardRule } from '@wslpilot/shared'
import {
  defaultPortForwardForm,
  formToRule,
  formatRuleRange,
  proxyToForm,
  ruleApplyCommand,
  ruleRemoveCommand,
  ruleSystemState,
  ruleSystemStateLabel,
  ruleToForm,
  summarizeRules,
  suggestRuleId,
  validatePortForwardForm,
  validateProxyForm,
} from '../../src/renderer/features/network/forms'

const RULE: PortForwardRule = {
  id: 'dev-3000',
  distro: 'Ubuntu',
  listenAddress: '0.0.0.0',
  listenPort: 3000,
  connectAddress: '127.0.0.1',
  connectPort: 3000,
  enabled: true,
  protocol: 'tcp',
}

const STATUS: NetworkStatus = {
  wslconfigPath: 'x',
  wslconfigExists: true,
  mode: 'nat',
  modeRaw: 'nat',
  mirrorRecommended: true,
  portProxy: [
    {
      listenAddress: '0.0.0.0',
      listenPort: 3000,
      connectAddress: '127.0.0.1',
      connectPort: 3000,
      kind: 'v4tov4',
    },
    {
      listenAddress: '0.0.0.0',
      listenPort: 9999,
      connectAddress: '10.0.0.1',
      connectPort: 9999,
      kind: 'v4tov4',
    },
  ],
  windowsProxy: null,
}

describe('表单 ↔ 领域模型', () => {
  it('defaultPortForwardForm', () => {
    const f = defaultPortForwardForm('Ubuntu')
    expect(f.distro).toBe('Ubuntu')
    expect(f.listenPort).toBe(3000)
    expect(f.originalId).toBe('')
  })

  it('ruleToForm / formToRule 往返', () => {
    const f = ruleToForm(RULE)
    expect(f.originalId).toBe('dev-3000')
    expect(formToRule(f)).toEqual(RULE)
  })

  it('formToRule 修剪空白并转数字', () => {
    const f = defaultPortForwardForm(' Ubuntu ')
    f.id = ' dev-1 '
    f.listenPort = null
    f.connectPort = ' 3000 ' as unknown as number
    const r = formToRule(f)
    expect(r.id).toBe('dev-1')
    expect(r.distro).toBe('Ubuntu')
    expect(r.listenPort).toBe(0)
    expect(r.connectPort).toBe(3000)
  })
})

describe('validatePortForwardForm', () => {
  it('通过合法表单', () => {
    expect(validatePortForwardForm(ruleToForm(RULE), [RULE])).toBeNull()
  })

  it('id 冲突检测（编辑自身豁免）', () => {
    const f = ruleToForm(RULE)
    expect(validatePortForwardForm(f, [RULE])).toBeNull()
    const renamed = { ...f, id: 'other', originalId: '' }
    expect(validatePortForwardForm(renamed, [RULE])).toBeNull()
    const dup = { ...defaultPortForwardForm('Ubuntu'), id: 'dev-3000' }
    expect(validatePortForwardForm(dup, [RULE])).toMatch(/已存在/)
  })

  it('缺发行版被拦截', () => {
    const f = { ...ruleToForm(RULE), distro: '' }
    expect(validatePortForwardForm(f, [])).toMatch(/发行版/)
  })
})

describe('suggestRuleId', () => {
  it('按端口生成并避让冲突', () => {
    expect(suggestRuleId([], 3000)).toBe('dev-3000')
    expect(suggestRuleId([RULE], 3000)).toBe('dev-3000-2')
    expect(
      suggestRuleId([RULE, { ...RULE, id: 'dev-3000-2' }, { ...RULE, id: 'dev-3000-3' }], 3000),
    ).toBe('dev-3000-4')
  })
})

describe('规则系统状态', () => {
  it('完全匹配 → 已生效', () => {
    expect(ruleSystemState(RULE, STATUS)).toBe('applied')
    expect(ruleSystemStateLabel('applied')).toBe('已生效')
  })

  it('监听键相同但指向不同 → 指向不同', () => {
    const r = { ...RULE, connectPort: 4000 }
    expect(ruleSystemState(r, STATUS)).toBe('mismatch')
    expect(ruleSystemStateLabel('mismatch')).toBe('指向不同')
  })

  it('系统无条目 → 未生效', () => {
    const r = { ...RULE, listenPort: 1234 }
    expect(ruleSystemState(r, STATUS)).toBe('none')
  })

  it('udp 规则 → 仅记录', () => {
    expect(ruleSystemState({ ...RULE, protocol: 'udp' }, STATUS)).toBe('udp-only')
    expect(ruleSystemStateLabel('udp-only')).toBe('仅记录')
    expect(ruleSystemStateLabel('listening')).toBe('监听中')
  })

  it('status 为空视为未生效', () => {
    expect(ruleSystemState(RULE, null)).toBe('none')
  })
})

describe('命令预览与摘要', () => {
  it('apply / remove 命令', () => {
    expect(ruleApplyCommand(RULE)).toContain('portproxy add v4tov4')
    expect(ruleRemoveCommand(RULE)).toContain('portproxy delete v4tov4')
  })

  it('summarizeRules', () => {
    expect(summarizeRules([])).toBe('（无规则）')
    expect(summarizeRules([RULE])).toContain('dev-3000')
  })

  it('formatRuleRange 处理 IPv6', () => {
    expect(formatRuleRange('0.0.0.0', 80)).toBe('0.0.0.0:80')
    expect(formatRuleRange('::1', 80)).toBe('[::1]:80')
  })
})

describe('代理表单', () => {
  it('proxyToForm', () => {
    const f = proxyToForm({
      useWindowsProxy: true,
      httpProxy: 'a',
      httpsProxy: 'b',
      noProxy: 'c',
    })
    expect(f).toEqual({ useWindowsProxy: true, httpProxy: 'a', httpsProxy: 'b', noProxy: 'c' })
  })

  it('validateProxyForm', () => {
    expect(
      validateProxyForm({ useWindowsProxy: false, httpProxy: '', httpsProxy: '', noProxy: '' }),
    ).toMatch(/请填写/)
    expect(
      validateProxyForm({
        useWindowsProxy: true,
        httpProxy: '',
        httpsProxy: '',
        noProxy: '',
      }),
    ).toBeNull()
    expect(
      validateProxyForm({
        useWindowsProxy: false,
        httpProxy: 'http://a:1',
        httpsProxy: '',
        noProxy: '',
      }),
    ).toBeNull()
    expect(
      validateProxyForm({
        useWindowsProxy: false,
        httpProxy: 'http://a b:1',
        httpsProxy: '',
        noProxy: '',
      }),
    ).toMatch(/空白/)
    expect(
      validateProxyForm({
        useWindowsProxy: false,
        httpProxy: '',
        httpsProxy: 'http://a b:1',
        noProxy: '',
      }),
    ).toMatch(/HTTPS/)
  })
})
