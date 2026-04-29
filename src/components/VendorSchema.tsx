// VendorSchema — emits LocalBusiness / OnlineStore / Organization schema
// for individual vendor pages, depending on vendor_type.

interface Vendor {
  slug: string
  name: string
  vendor_type: string
  description?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  county?: string | null
  postcode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  logo_url?: string | null
  image_url?: string | null
  verified?: boolean
}

const PHYSICAL = ['physical_shop', 'retailer']
const GRADER   = 'grading_service'

export default function VendorSchema({ vendor }: { vendor: Vendor }) {
  if (!vendor) return null

  const url = `https://www.pokeprices.io/vendors/${vendor.slug}`
  const isPhysical = PHYSICAL.includes(vendor.vendor_type)
  const isGrader   = vendor.vendor_type === GRADER

  // Pick @type based on vendor type
  let entityType: string = 'Organization'
  if (isPhysical) entityType = 'Store'
  else if (vendor.vendor_type === 'online_shop' || vendor.vendor_type === 'ebay_store') entityType = 'OnlineStore'
  else if (isGrader) entityType = 'ProfessionalService'

  const schema: any = {
    '@context': 'https://schema.org',
    '@type': entityType,
    '@id': `${url}#entity`,
    name: vendor.name,
    url: vendor.website || url,
    sameAs: vendor.website ? [vendor.website] : undefined,
    description: vendor.description || undefined,
    image: vendor.image_url || vendor.logo_url || undefined,
    logo: vendor.logo_url || undefined,
    telephone: vendor.phone || undefined,
    email: vendor.email || undefined,
  }

  if (vendor.address || vendor.city || vendor.postcode) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: vendor.address || undefined,
      addressLocality: vendor.city || undefined,
      addressRegion: vendor.county || undefined,
      postalCode: vendor.postcode || undefined,
      addressCountry: vendor.country || 'GB',
    }
  }

  if (vendor.latitude != null && vendor.longitude != null) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: vendor.latitude,
      longitude: vendor.longitude,
    }
  }

  // Strip undefined keys (Google validators are strict about empty fields)
  const clean = JSON.parse(JSON.stringify(schema))

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(clean) }}
    />
  )
}
