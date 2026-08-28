import { useState } from 'react'
import type { ChangeEvent } from 'react'
import JSZip from 'jszip'
import './App.css'

type DocumentInfo = {
  envelopeFile: string
  documentFile: string
  documentType: string
  documentFormat: string
}

type PartyData = {
  role: 'SE' | 'BY'
  name: string
  address: string
  city: string
  postalCode: string
  country: string
  taxNumber: string
  vatNumber: string
  eAddress: string
  eLocation: string
  iban: string
  bic: string
}

function getChildrenByLocalName(
  element: Element,
  localName: string,
): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === localName,
  )
}

function getFirstChildByLocalName(
  element: Element,
  localName: string,
): Element | null {
  return (
    Array.from(element.children).find(
      (child) => child.localName === localName,
    ) ?? null
  )
}

function getDescendantText(
  element: Element,
  path: string[],
): string {
  let current: Element | null = element

  for (const part of path) {
    if (!current) return ''

    current = getFirstChildByLocalName(
      current,
      part,
    )
  }

  return current?.textContent?.trim() ?? ''
}

function setExistingDescendantText(
  element: Element,
  path: string[],
  value: string,
): boolean {
  let current: Element | null = element

  for (const part of path) {
    if (!current) return false

    current = getFirstChildByLocalName(
      current,
      part,
    )
  }

  if (!current) return false

  current.textContent = value
  return true
}

function findPartyElement(
  invoiceDocument: XMLDocument,
  role: 'SE' | 'BY',
): Element | null {
  const sg2Elements = Array.from(
    invoiceDocument.getElementsByTagName('*'),
  ).filter(
    (element) => element.localName === 'G_SG2',
  )

  for (const sg2 of sg2Elements) {
    const nad = getFirstChildByLocalName(
      sg2,
      'S_NAD',
    )

    if (!nad) continue

    const partyRole = getDescendantText(
      nad,
      ['D_3035'],
    )

    if (partyRole === role) {
      return sg2
    }
  }

  return null
}

function getReferenceValue(
  sg2: Element,
  qualifier: string,
): string {
  const sg3Elements =
    getChildrenByLocalName(
      sg2,
      'G_SG3',
    )

  for (const sg3 of sg3Elements) {
    const rff =
      getFirstChildByLocalName(
        sg3,
        'S_RFF',
      )

    if (!rff) continue

    const c506 =
      getFirstChildByLocalName(
        rff,
        'C_C506',
      )

    if (!c506) continue

    const currentQualifier =
      getDescendantText(
        c506,
        ['D_1153'],
      )

    if (currentQualifier === qualifier) {
      return getDescendantText(
        c506,
        ['D_1154'],
      )
    }
  }

  return ''
}

function setReferenceValue(
  sg2: Element,
  qualifier: string,
  value: string,
): boolean {
  const sg3Elements =
    getChildrenByLocalName(
      sg2,
      'G_SG3',
    )

  for (const sg3 of sg3Elements) {
    const rff =
      getFirstChildByLocalName(
        sg3,
        'S_RFF',
      )

    if (!rff) continue

    const c506 =
      getFirstChildByLocalName(
        rff,
        'C_C506',
      )

    if (!c506) continue

    const currentQualifier =
      getDescendantText(
        c506,
        ['D_1153'],
      )

    if (currentQualifier !== qualifier) {
      continue
    }

    const valueElement =
      getFirstChildByLocalName(
        c506,
        'D_1154',
      )

    if (!valueElement) return false

    valueElement.textContent = value
    return true
  }

  return false
}

function getFinancialInfo(
  sg2: Element,
  role: 'SE' | 'BY',
): {
  iban: string
  bic: string
} {
  const fiiElements =
    getChildrenByLocalName(
      sg2,
      'S_FII',
    )

  if (fiiElements.length === 0) {
    return {
      iban: '',
      bic: '',
    }
  }

  const expectedQualifier =
    role === 'SE'
      ? 'RB'
      : 'BB'

  const matchedFii =
    fiiElements.find(
      (fii) =>
        getDescendantText(
          fii,
          ['D_3035'],
        ) === expectedQualifier,
    ) ?? fiiElements[0]

  return {
    iban: getDescendantText(
      matchedFii,
      ['C_C078', 'D_3194'],
    ),

    bic: getDescendantText(
      matchedFii,
      ['C_C088', 'D_3433'],
    ),
  }
}

function updateFinancialInfo(
  sg2: Element,
  party: PartyData,
): string[] {
  const warnings: string[] = []

  const fiiElements =
    getChildrenByLocalName(
      sg2,
      'S_FII',
    )

  if (fiiElements.length === 0) {
    if (party.iban || party.bic) {
      warnings.push(
        `${party.role}: S_FII ne obstaja, zato IBAN/BIC v eSLOG-u nista bila spremenjena.`,
      )
    }

    return warnings
  }

  const expectedQualifier =
    party.role === 'SE'
      ? 'RB'
      : 'BB'

  const fii =
    fiiElements.find(
      (element) =>
        getDescendantText(
          element,
          ['D_3035'],
        ) === expectedQualifier,
    ) ?? fiiElements[0]

  if (
    !setExistingDescendantText(
      fii,
      ['C_C078', 'D_3194'],
      party.iban,
    )
  ) {
    if (party.iban) {
      warnings.push(
        `${party.role}: IBAN / D_3194 ne obstaja.`,
      )
    }
  }

  if (
    !setExistingDescendantText(
      fii,
      ['C_C088', 'D_3433'],
      party.bic,
    )
  ) {
    if (party.bic) {
      warnings.push(
        `${party.role}: BIC / D_3433 ne obstaja.`,
      )
    }
  }

  return warnings
}

function getEnvelopeHeader(
  envelopeDocument: XMLDocument,
): Element | null {
  return getFirstChildByLocalName(
    envelopeDocument.documentElement,
    'header',
  )
}

function getEnvelopeSide(
  envelopeDocument: XMLDocument,
  side: 'from' | 'to',
): Element | null {
  const header =
    getEnvelopeHeader(
      envelopeDocument,
    )

  if (!header) return null

  return getFirstChildByLocalName(
    header,
    side,
  )
}

function getEnvelopeParams(
  envelopeDocument: XMLDocument,
): Element | null {
  const header =
    getEnvelopeHeader(
      envelopeDocument,
    )

  if (!header) return null

  return getFirstChildByLocalName(
    header,
    'params',
  )
}

function getEnvelopeParam(
  envelopeDocument: XMLDocument,
  name: string,
): string {
  const params =
    getEnvelopeParams(
      envelopeDocument,
    )

  if (!params) return ''

  const paramElements =
    getChildrenByLocalName(
      params,
      'param',
    )

  const param =
    paramElements.find(
      (element) =>
        element.getAttribute('Name') === name,
    )

  return param?.getAttribute('Value') ?? ''
}

function setExistingEnvelopeParam(
  envelopeDocument: XMLDocument,
  name: string,
  value: string,
): boolean {
  const params =
    getEnvelopeParams(
      envelopeDocument,
    )

  if (!params) return false

  const paramElements =
    getChildrenByLocalName(
      params,
      'param',
    )

  const param =
    paramElements.find(
      (element) =>
        element.getAttribute('Name') === name,
    )

  if (!param) return false

  param.setAttribute(
    'Value',
    value,
  )

  return true
}

function getEnvelopeFinancialInfo(
  envelopeDocument: XMLDocument,
  role: 'SE' | 'BY',
): {
  iban: string
  bic: string
} {
  if (role === 'SE') {
    return {
      iban:
        getEnvelopeParam(
          envelopeDocument,
          'pd_issuer_account',
        ) ||
        getEnvelopeParam(
          envelopeDocument,
          'ii_account_id',
        ),

      bic:
        getEnvelopeParam(
          envelopeDocument,
          'pd_issuer_agent',
        ) ||
        getEnvelopeParam(
          envelopeDocument,
          'ii_sender_agent',
        ),
    }
  }

  return {
    iban:
      getEnvelopeParam(
        envelopeDocument,
        'pd_recipient_account',
      ) ||
      getEnvelopeParam(
        envelopeDocument,
        'ri_account_id',
      ),

    bic:
      getEnvelopeParam(
        envelopeDocument,
        'pd_recipient_agent',
      ) ||
      getEnvelopeParam(
        envelopeDocument,
        'ri_receiver_agent',
      ),
  }
}

function parseParty(
  invoiceDocument: XMLDocument,
  envelopeDocument: XMLDocument,
  role: 'SE' | 'BY',
): PartyData | null {
  const sg2 =
    findPartyElement(
      invoiceDocument,
      role,
    )

  if (!sg2) return null

  const nad =
    getFirstChildByLocalName(
      sg2,
      'S_NAD',
    )

  if (!nad) return null

  const invoiceFinancial =
    getFinancialInfo(
      sg2,
      role,
    )

  const envelopeFinancial =
    getEnvelopeFinancialInfo(
      envelopeDocument,
      role,
    )

  const side =
    role === 'SE'
      ? 'from'
      : 'to'

  const envelopeSide =
    getEnvelopeSide(
      envelopeDocument,
      side,
    )

  return {
    role,

    name: getDescendantText(
      nad,
      ['C_C080', 'D_3036'],
    ),

    address: getDescendantText(
      nad,
      ['C_C059', 'D_3042'],
    ),

    city: getDescendantText(
      nad,
      ['D_3164'],
    ),

    postalCode:
      getDescendantText(
        nad,
        ['D_3251'],
      ),

    country: getDescendantText(
      nad,
      ['D_3207'],
    ),

    taxNumber:
      getReferenceValue(
        sg2,
        'AHP',
      ),

    vatNumber:
      getReferenceValue(
        sg2,
        'VA',
      ),

    eAddress: envelopeSide
      ? getDescendantText(
          envelopeSide,
          ['e_address'],
        )
      : '',

    eLocation: envelopeSide
      ? getDescendantText(
          envelopeSide,
          ['e_location'],
        )
      : '',

    iban:
      invoiceFinancial.iban ||
      envelopeFinancial.iban,

    bic:
      invoiceFinancial.bic ||
      envelopeFinancial.bic,
  }
}

function updateInvoiceParty(
  invoiceDocument: XMLDocument,
  party: PartyData,
): string[] {
  const warnings: string[] = []

  const sg2 =
    findPartyElement(
      invoiceDocument,
      party.role,
    )

  if (!sg2) {
    warnings.push(
      `${party.role}: G_SG2 ni bil najden.`,
    )

    return warnings
  }

  const nad =
    getFirstChildByLocalName(
      sg2,
      'S_NAD',
    )

  if (!nad) {
    warnings.push(
      `${party.role}: S_NAD ni bil najden.`,
    )

    return warnings
  }

  const fields = [
    {
      label: 'naziv',
      path: ['C_C080', 'D_3036'],
      value: party.name,
    },
    {
      label: 'naslov',
      path: ['C_C059', 'D_3042'],
      value: party.address,
    },
    {
      label: 'kraj',
      path: ['D_3164'],
      value: party.city,
    },
    {
      label: 'pošta',
      path: ['D_3251'],
      value: party.postalCode,
    },
    {
      label: 'država',
      path: ['D_3207'],
      value: party.country,
    },
  ]

  for (const field of fields) {
    if (
      !setExistingDescendantText(
        nad,
        field.path,
        field.value,
      )
    ) {
      warnings.push(
        `${party.role}: ${field.label} ne obstaja v eSLOG-u.`,
      )
    }
  }

  if (
    !setReferenceValue(
      sg2,
      'AHP',
      party.taxNumber,
    )
  ) {
    warnings.push(
      `${party.role}: RFF/AHP ne obstaja.`,
    )
  }

  if (
    !setReferenceValue(
      sg2,
      'VA',
      party.vatNumber,
    )
  ) {
    warnings.push(
      `${party.role}: RFF/VA ne obstaja.`,
    )
  }

  warnings.push(
    ...updateFinancialInfo(
      sg2,
      party,
    ),
  )

  return warnings
}

function buildEnvelopeAddress(
  party: PartyData,
): string {
  const cityPart = [
    party.postalCode,
    party.city,
  ]
    .filter(Boolean)
    .join(' ')

  return [
    party.address,
    cityPart,
  ]
    .filter(Boolean)
    .join(', ')
}

function updateEnvelopeBankData(
  envelopeDocument: XMLDocument,
  party: PartyData,
): string[] {
  const warnings: string[] = []

  const ibanParams =
    party.role === 'SE'
      ? [
          'ii_account_id',
          'pd_issuer_account',
        ]
      : [
          'pd_recipient_account',
          'ri_account_id',
        ]

  const bicParams =
    party.role === 'SE'
      ? [
          'ii_sender_agent',
          'pd_issuer_agent',
        ]
      : [
          'pd_recipient_agent',
          'ri_receiver_agent',
        ]

  for (const paramName of ibanParams) {
    setExistingEnvelopeParam(
      envelopeDocument,
      paramName,
      party.iban,
    )
  }

  for (const paramName of bicParams) {
    setExistingEnvelopeParam(
      envelopeDocument,
      paramName,
      party.bic,
    )
  }

  if (party.role === 'BY') {
    const to =
      getEnvelopeSide(
        envelopeDocument,
        'to',
      )

    if (to) {
      const eAddress1 =
        getFirstChildByLocalName(
          to,
          'e_address1',
        )

      if (eAddress1) {
        const currentValue =
          eAddress1.textContent?.trim() ?? ''

        if (currentValue.includes('@')) {
          const parts =
            currentValue.split('@')

          const suffix =
            parts.slice(1).join('@')

          eAddress1.textContent =
            `${party.iban}@${suffix}`
        } else if (currentValue) {
          warnings.push(
            'Ovojnica BY: e_address1 obstaja, vendar ni v obliki IBAN@davčna, zato ni bil spremenjen.',
          )
        }
      }
    }
  }

  return warnings
}

function updateEnvelopeParty(
  envelopeDocument: XMLDocument,
  party: PartyData,
): string[] {
  const warnings: string[] = []

  const sideName =
    party.role === 'SE'
      ? 'from'
      : 'to'

  const side =
    getEnvelopeSide(
      envelopeDocument,
      sideName,
    )

  if (!side) {
    warnings.push(
      `Ovojnica: ${sideName} ne obstaja.`,
    )

    return warnings
  }

  if (
    !setExistingDescendantText(
      side,
      ['e_address'],
      party.eAddress,
    )
  ) {
    if (party.eAddress) {
      warnings.push(
        `Ovojnica ${sideName}: e_address ne obstaja.`,
      )
    }
  }

  if (
    !setExistingDescendantText(
      side,
      ['e_location'],
      party.eLocation,
    )
  ) {
    if (party.eLocation) {
      warnings.push(
        `Ovojnica ${sideName}: e_location ne obstaja in ni bil dodan.`,
      )
    }
  }

  const physicalAddress =
    getFirstChildByLocalName(
      side,
      'physical-address',
    )

  if (physicalAddress) {
    setExistingDescendantText(
      physicalAddress,
      ['name'],
      party.name,
    )

    setExistingDescendantText(
      physicalAddress,
      ['address'],
      buildEnvelopeAddress(
        party,
      ),
    )

    setExistingDescendantText(
      physicalAddress,
      ['country'],
      party.country,
    )
  }

  warnings.push(
    ...updateEnvelopeBankData(
      envelopeDocument,
      party,
    ),
  )

  return warnings
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="input-field">
      <span>{label}</span>

      <input
        value={value}
        placeholder={
          placeholder ?? ''
        }
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
      />
    </label>
  )
}

function PartyEditor({
  title,
  roleLabel,
  party,
  setParty,
}: {
  title: string
  roleLabel: string
  party: PartyData
  setParty: (party: PartyData) => void
}) {
  function update(
    field: keyof PartyData,
    value: string,
  ) {
    setParty({
      ...party,
      [field]: value,
    })
  }

  function updateVatNumber(
    newVatNumber: string,
  ) {
    const oldVatNumber =
      party.vatNumber

    const oldStandardEAddress =
      oldVatNumber
        ? `${oldVatNumber}.HQ`
        : ''

    const oldStandardELocation =
      oldVatNumber
        ? `C:${oldVatNumber}`
        : ''

    let newEAddress =
      party.eAddress

    let newELocation =
      party.eLocation

    if (
      !party.eAddress ||
      party.eAddress ===
        oldStandardEAddress
    ) {
      newEAddress =
        newVatNumber
          ? `${newVatNumber}.HQ`
          : ''
    }

    if (
      !party.eLocation ||
      party.eLocation ===
        oldStandardELocation
    ) {
      newELocation =
        newVatNumber
          ? `C:${newVatNumber}`
          : ''
    }

    setParty({
      ...party,
      vatNumber: newVatNumber,
      eAddress: newEAddress,
      eLocation: newELocation,
    })
  }

  return (
    <article className="party-card">
      <div className="party-header">
        <div>
          <span className="party-role">
            {roleLabel}
          </span>

          <h2>{title}</h2>
        </div>

        <span className="party-code">
          {party.role}
        </span>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <h3>Podjetje</h3>
          <p>
            Podatki iz S_NAD in RFF.
          </p>
        </div>

        <div className="fields">
          <InputField
            label="Naziv"
            value={party.name}
            onChange={(value) =>
              update('name', value)
            }
          />

          <div className="two-columns">
            <InputField
              label="Davčna / AHP"
              value={party.taxNumber}
              placeholder="Ni podatka"
              onChange={(value) =>
                update(
                  'taxNumber',
                  value,
                )
              }
            />

            <InputField
              label="DDV / VA"
              value={party.vatNumber}
              placeholder="Ni podatka"
              onChange={
                updateVatNumber
              }
            />
          </div>

          <InputField
            label="Naslov"
            value={party.address}
            onChange={(value) =>
              update(
                'address',
                value,
              )
            }
          />

          <div className="two-columns">
            <InputField
              label="Kraj"
              value={party.city}
              onChange={(value) =>
                update(
                  'city',
                  value,
                )
              }
            />

            <InputField
              label="Poštna številka"
              value={
                party.postalCode
              }
              onChange={(value) =>
                update(
                  'postalCode',
                  value,
                )
              }
            />
          </div>

          <InputField
            label="Država"
            value={party.country}
            onChange={(value) =>
              update(
                'country',
                value,
              )
            }
          />
        </div>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <h3>Bančni podatki</h3>
          <p>
            eSLOG S_FII in obstoječi
            parametri ovojnice.
          </p>
        </div>

        <div className="fields two-columns">
          <InputField
            label="IBAN"
            value={party.iban}
            placeholder="Ni podatka"
            onChange={(value) =>
              update(
                'iban',
                value,
              )
            }
          />

          <InputField
            label="BIC / SWIFT"
            value={party.bic}
            placeholder="Ni podatka"
            onChange={(value) =>
              update(
                'bic',
                value,
              )
            }
          />
        </div>
      </div>

      <div className="editor-section">
        <div className="section-heading">
          <h3>Routing</h3>
          <p>
            Podatki iz bizBox
            ovojnice.
          </p>
        </div>

        <div className="fields">
          <InputField
            label="eAddress"
            value={party.eAddress}
            placeholder="Ni v ovojnici"
            onChange={(value) =>
              update(
                'eAddress',
                value,
              )
            }
          />

          <InputField
            label="eLocation"
            value={party.eLocation}
            placeholder="Ni v ovojnici"
            onChange={(value) =>
              update(
                'eLocation',
                value,
              )
            }
          />
        </div>
      </div>
    </article>
  )
}

function App() {
  const [
    fileName,
    setFileName,
  ] =
    useState<string | null>(
      null,
    )

  const [
    zipFiles,
    setZipFiles,
  ] =
    useState<string[]>(
      [],
    )

  const [
    originalZip,
    setOriginalZip,
  ] =
    useState<JSZip | null>(
      null,
    )

  const [
    documentInfo,
    setDocumentInfo,
  ] =
    useState<DocumentInfo | null>(
      null,
    )

  const [
    seller,
    setSeller,
  ] =
    useState<PartyData | null>(
      null,
    )

  const [
    buyer,
    setBuyer,
  ] =
    useState<PartyData | null>(
      null,
    )

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    )

  const [
    warnings,
    setWarnings,
  ] =
    useState<string[]>(
      [],
    )

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0]

    if (!file) return

    if (
      !file.name
        .toLowerCase()
        .endsWith('.zip')
    ) {
      setError(
        'Prosim izberi ZIP datoteko.',
      )

      return
    }

    try {
      setError(null)
      setWarnings([])

      const zip =
        await JSZip.loadAsync(
          file,
        )

      setOriginalZip(
        zip,
      )

      const files =
        Object.values(
          zip.files,
        )
          .filter(
            (entry) =>
              !entry.dir,
          )
          .map(
            (entry) =>
              entry.name,
          )

      setFileName(
        file.name,
      )

      setZipFiles(
        files,
      )

      const parser =
        new DOMParser()

      let envelopeName:
        | string
        | null = null

      let envelopeXml:
        | string
        | null = null

      for (const name of files) {
        if (
          !name
            .toLowerCase()
            .endsWith('.xml')
        ) {
          continue
        }

        const entry =
          zip.file(name)

        if (!entry) continue

        const xmlText =
          await entry.async(
            'text',
          )

        const xml =
          parser.parseFromString(
            xmlText,
            'application/xml',
          )

        if (
          xml.querySelector(
            'parsererror',
          )
        ) {
          continue
        }

        if (
          xml.documentElement.localName.toLowerCase() ===
          'envelope'
        ) {
          envelopeName = name
          envelopeXml = xmlText
          break
        }
      }

      if (
        !envelopeName ||
        !envelopeXml
      ) {
        throw new Error(
          'V ZIP-u ni bila najdena bizBox ovojnica.',
        )
      }

      const envelopeDocument =
        parser.parseFromString(
          envelopeXml,
          'application/xml',
        )

      const documentElement =
        getFirstChildByLocalName(
          envelopeDocument.documentElement,
          'document',
        )

      if (!documentElement) {
        throw new Error(
          'V ovojnici ni bil najden glavni dokument.',
        )
      }

      const documentFile =
        getDescendantText(
          documentElement,
          ['file_name'],
        )

      const documentType =
        getDescendantText(
          documentElement,
          ['type'],
        )

      const documentFormat =
        getDescendantText(
          documentElement,
          ['format'],
        )

      if (!documentFile) {
        throw new Error(
          'V ovojnici manjka file_name.',
        )
      }

      const invoiceEntry =
        zip.file(
          documentFile,
        )

      if (!invoiceEntry) {
        throw new Error(
          `Datoteka ${documentFile} ni bila najdena.`,
        )
      }

      const invoiceXml =
        await invoiceEntry.async(
          'text',
        )

      const invoiceDocument =
        parser.parseFromString(
          invoiceXml,
          'application/xml',
        )

      if (
        invoiceDocument.querySelector(
          'parsererror',
        )
      ) {
        throw new Error(
          'Glavni eSLOG XML ni veljaven XML.',
        )
      }

      const parsedSeller =
        parseParty(
          invoiceDocument,
          envelopeDocument,
          'SE',
        )

      const parsedBuyer =
        parseParty(
          invoiceDocument,
          envelopeDocument,
          'BY',
        )

      if (!parsedSeller) {
        throw new Error(
          'Pošiljatelj SE ni bil najden.',
        )
      }

      if (!parsedBuyer) {
        throw new Error(
          'Prejemnik BY ni bil najden.',
        )
      }

      setSeller(
        parsedSeller,
      )

      setBuyer(
        parsedBuyer,
      )

      setDocumentInfo({
        envelopeFile:
          envelopeName,
        documentFile,
        documentType,
        documentFormat,
      })
    } catch (err) {
      console.error(err)

      setError(
        err instanceof Error
          ? err.message
          : 'Napaka pri analizi ZIP-a.',
      )
    }
  }

  async function generateZip() {
    if (
      !originalZip ||
      !documentInfo ||
      !seller ||
      !buyer ||
      !fileName
    ) {
      return
    }

    try {
      setError(null)

      const parser =
        new DOMParser()

      const serializer =
        new XMLSerializer()

      const invoiceEntry =
        originalZip.file(
          documentInfo.documentFile,
        )

      const envelopeEntry =
        originalZip.file(
          documentInfo.envelopeFile,
        )

      if (
        !invoiceEntry ||
        !envelopeEntry
      ) {
        throw new Error(
          'XML datoteki nista bili najdeni.',
        )
      }

      const invoiceXml =
        await invoiceEntry.async(
          'text',
        )

      const envelopeXml =
        await envelopeEntry.async(
          'text',
        )

      const invoiceDocument =
        parser.parseFromString(
          invoiceXml,
          'application/xml',
        )

      const envelopeDocument =
        parser.parseFromString(
          envelopeXml,
          'application/xml',
        )

      const newWarnings = [
        ...updateInvoiceParty(
          invoiceDocument,
          seller,
        ),

        ...updateInvoiceParty(
          invoiceDocument,
          buyer,
        ),

        ...updateEnvelopeParty(
          envelopeDocument,
          seller,
        ),

        ...updateEnvelopeParty(
          envelopeDocument,
          buyer,
        ),
      ]

      setWarnings(
        newWarnings,
      )

      const modifiedZip =
        await JSZip.loadAsync(
          await originalZip.generateAsync({
            type: 'blob',
          }),
        )

      modifiedZip.file(
        documentInfo.documentFile,
        serializer.serializeToString(
          invoiceDocument,
        ),
      )

      modifiedZip.file(
        documentInfo.envelopeFile,
        serializer.serializeToString(
          envelopeDocument,
        ),
      )

      const blob =
        await modifiedZip.generateAsync({
          type: 'blob',
          compression:
            'DEFLATE',
        })

      const url =
        URL.createObjectURL(
          blob,
        )

      const link =
        document.createElement(
          'a',
        )

      link.href = url

      link.download =
        fileName.replace(
          /\.zip$/i,
          '',
        ) +
        '_modified.zip'

      document.body.appendChild(
        link,
      )

      link.click()
      link.remove()

      setTimeout(
        () => {
          URL.revokeObjectURL(
            url,
          )
        },
        1000,
      )
    } catch (err) {
      console.error(err)

      setError(
        err instanceof Error
          ? err.message
          : 'ZIP-a ni bilo mogoče ustvariti.',
      )
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-badge">
          ZZI internal tool
        </div>

        <h1>
          eSLOG ZIP Editor
        </h1>

        <p>
          Hitro prilagodi testni eSLOG
          paket brez ročnega urejanja
          XML datotek.
        </p>

        <div className="privacy-note">
          <span className="privacy-dot" />

          Obdelava poteka lokalno v
          brskalniku
        </div>
      </section>

      <section className="upload-card">
        <label className="drop-zone">
          <input
            type="file"
            accept=".zip"
            onChange={
              handleFileChange
            }
          />

          <div className="upload-icon">
            ↑
          </div>

          <div>
            <span className="drop-title">
              {fileName ??
                'Izberi bizBox ZIP'}
            </span>

            <span className="drop-description">
              Klikni za izbiro
              datoteke
            </span>
          </div>

          <span className="file-type">
            ZIP
          </span>
        </label>
      </section>

      {error && (
        <section className="message-card error-card">
          <span>⚠</span>

          <div>
            <strong>
              Napaka
            </strong>

            <p>{error}</p>
          </div>
        </section>
      )}

      {documentInfo && (
        <section className="document-card">
          <div className="card-heading">
            <div>
              <span className="small-label">
                Dokument
              </span>

              <h2>
                Prepoznan paket
              </h2>
            </div>

            <span className="success-pill">
              ✓ pripravljen
            </span>
          </div>

          <div className="document-grid">
            <div>
              <span>
                Ovojnica
              </span>

              <strong>
                {
                  documentInfo.envelopeFile
                }
              </strong>
            </div>

            <div>
              <span>
                Glavni dokument
              </span>

              <strong>
                {
                  documentInfo.documentFile
                }
              </strong>
            </div>

            <div>
              <span>
                Tip
              </span>

              <strong>
                {
                  documentInfo.documentType
                }
              </strong>
            </div>

            <div>
              <span>
                Format
              </span>

              <strong>
                {
                  documentInfo.documentFormat
                }
              </strong>
            </div>
          </div>
        </section>
      )}

      {seller && buyer && (
        <>
          <section className="parties-grid">
            <PartyEditor
              title={seller.name || 'Pošiljatelj'}
              roleLabel="Pošiljatelj"
              party={seller}
              setParty={
                setSeller
              }
            />

            <PartyEditor
              title={buyer.name || 'Prejemnik'}
              roleLabel="Prejemnik"
              party={buyer}
              setParty={
                setBuyer
              }
            />
          </section>

          <section className="action-card">
            <div>
              <strong>
                Pripravi nov paket
              </strong>

              <p>
                Originalni ZIP ostane
                nespremenjen.
              </p>
            </div>

            <button
              className="generate-button"
              onClick={
                generateZip
              }
            >
              <span>
                Generate modified ZIP
              </span>

              <span>
                ↓
              </span>
            </button>
          </section>
        </>
      )}

      {warnings.length > 0 && (
        <section className="message-card warning-card">
          <span>⚠</span>

          <div>
            <strong>
              Opozorila
            </strong>

            <div className="warning-list">
              {warnings.map(
                (warning) => (
                  <p
                    key={
                      warning
                    }
                  >
                    {warning}
                  </p>
                ),
              )}
            </div>
          </div>
        </section>
      )}

      {zipFiles.length > 0 && (
        <details className="zip-card">
          <summary>
            <span>
              Vsebina ZIP-a
            </span>

            <span>
              {zipFiles.length}{' '}
              datotek
            </span>
          </summary>

          <div className="file-list">
            {zipFiles.map(
              (name) => (
                <div
                  key={
                    name
                  }
                >
                  <span>
                    ◻
                  </span>

                  {name}
                </div>
              ),
            )}
          </div>
        </details>
      )}

      <footer>
        eSLOG ZIP Editor · ZZI
      </footer>
    </main>
  )
}

export default App