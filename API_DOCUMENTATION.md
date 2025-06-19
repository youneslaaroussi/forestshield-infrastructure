# 🌳 ForestShield API Documentation

## Overview

ForestShield provides a comprehensive REST API for real-time deforestation monitoring using Sentinel-2 satellite imagery and AWS machine learning services. This documentation covers all endpoints available for building dashboard applications.

**Base URL**: `http://localhost:3000` (development) or your deployed URL  
**Interactive Documentation**: `http://localhost:3000/api/docs` (Swagger UI)

---

## 🔧 Setup & Configuration

### CORS Configuration
The API is configured to accept requests from common development and deployment origins:
- `http://localhost:3000-8080` (Local development)
- `*.vercel.app` (Vercel deployments)
- `*.netlify.app` (Netlify deployments)

### Authentication
Currently, the API operates without authentication. For production deployments, consider implementing:
- JWT token authentication
- API key validation
- Rate limiting

---

## 📊 Dashboard Endpoints

### 1. Dashboard Statistics

**GET** `/dashboard/stats`

Returns overview statistics for the main dashboard.

**Response:**
```json
{
  "totalRegions": 12,
  "activeAlerts": 3,
  "avgDeforestation": 8.5,
  "imagesProcessed": 156,
  "activeJobs": 2,
  "lastUpdate": "2024-01-15T10:30:00Z"
}
```

---

### 2. Region Management

#### Get All Regions
**GET** `/dashboard/regions`

**Query Parameters:**
- `status` (optional): Filter by status (`ACTIVE`, `PAUSED`, `MONITORING`)

**Response:**
```json
[
  {
    "id": "region-amazon-001",
    "name": "Amazon Rainforest - Sector A",
    "latitude": -6.0,
    "longitude": -53.0,
    "description": "Critical deforestation hotspot in Pará, Brazil",
    "radiusKm": 10,
    "cloudCoverThreshold": 20,
    "status": "ACTIVE",
    "createdAt": "2024-01-01T00:00:00Z",
    "lastDeforestationPercentage": 12.5,
    "lastAnalysis": "2024-01-15T10:30:00Z"
  }
]
```

#### Create New Region
**POST** `/dashboard/regions`

**Request Body:**
```json
{
  "name": "Amazon Rainforest - Sector C",
  "latitude": -7.5,
  "longitude": -55.2,
  "description": "New monitoring area near Novo Progresso",
  "radiusKm": 15,
  "cloudCoverThreshold": 25
}
```

**Response:** Returns the created region with generated `id` and timestamps.

#### Get Region Details
**GET** `/dashboard/regions/{regionId}`

Returns detailed information about a specific region.

#### Update Region
**PUT** `/dashboard/regions/{regionId}`

Updates monitoring settings for an existing region.

#### Delete Region
**DELETE** `/dashboard/regions/{regionId}`

Removes a region from monitoring.

---

### 3. Alert Management

#### Get Alerts
**GET** `/dashboard/alerts`

**Query Parameters:**
- `level` (optional): Filter by alert level (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`)
- `acknowledged` (optional): Filter by acknowledgment status (`true`/`false`)
- `limit` (optional): Maximum number of alerts to return (default: 50)

**Response:**
```json
[
  {
    "id": "alert-001",
    "regionId": "region-amazon-001",
    "regionName": "Amazon Rainforest - Sector A",
    "level": "HIGH",
    "deforestationPercentage": 15.2,
    "message": "🚨 HIGH DEFORESTATION: 15.2% vegetation loss detected",
    "timestamp": "2024-01-15T10:30:00Z",
    "acknowledged": false
  }
]
```

#### Acknowledge Alert
**PUT** `/dashboard/alerts/{alertId}/acknowledge`

Marks an alert as acknowledged by the user.

---

### 4. Historical Data & Trends

#### Get Region Trends
**GET** `/dashboard/trends/{regionId}`

**Query Parameters:**
- `days` (optional): Number of days to analyze (default: 30)

**Response:**
```json
{
  "regionId": "region-amazon-001",
  "regionName": "Amazon Rainforest - Sector A",
  "dataPoints": [
    {
      "date": "2024-01-01T10:00:00Z",
      "vegetationPercentage": 85.2,
      "deforestationPercentage": 3.1,
      "ndviValue": 0.72,
      "cloudCover": 15
    },
    {
      "date": "2024-01-08T10:00:00Z",
      "vegetationPercentage": 82.8,
      "deforestationPercentage": 6.4,
      "ndviValue": 0.68,
      "cloudCover": 12
    }
  ],
  "vegetationTrend": -2.5,
  "trendDirection": "DECLINING",
  "analysisPeriodDays": 30
}
```

---

### 5. Real-time Monitoring

#### Get Active Jobs
**GET** `/dashboard/jobs`

**Query Parameters:**
- `status` (optional): Filter by job status (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`)

**Response:**
```json
[
  {
    "jobId": "job-001",
    "regionId": "region-amazon-001",
    "regionName": "Amazon Rainforest - Sector A",
    "status": "IN_PROGRESS",
    "progress": 75,
    "startTime": "2024-01-15T10:00:00Z",
    "totalImages": 12,
    "processedImages": 9
  }
]
```

#### Trigger Manual Analysis
**POST** `/dashboard/regions/{regionId}/analyze`

Manually triggers a deforestation analysis for a specific region.

**Response:**
```json
{
  "message": "Analysis started for region region-amazon-001",
  "jobId": "job-1705312345"
}
```

---

### 6. Geographic Visualization

#### Get Heatmap Data
**GET** `/dashboard/heatmap`

**Query Parameters (all required):**
- `north`: North boundary latitude
- `south`: South boundary latitude  
- `east`: East boundary longitude
- `west`: West boundary longitude
- `days` (optional): Number of days to analyze (default: 30)

**Response:**
```json
{
  "bounds": {
    "north": -5.9,
    "south": -6.1,
    "east": -52.9,
    "west": -53.1
  },
  "data": [
    {
      "lat": -6.0,
      "lng": -53.0,
      "intensity": 15.2,
      "cellSize": 0.1
    }
  ],
  "generatedAt": "2024-01-15T10:30:00Z",
  "periodDays": 30
}
```

---

## 🔬 Analysis Endpoints

### 1. Health Check
**GET** `/sentinel/health`

Returns service health status and basic information.

### 2. Search Satellite Images
**POST** `/sentinel/search`

**Request Body:**
```json
{
  "latitude": -6.0,
  "longitude": -53.0,
  "startDate": "2022-06-01",
  "endDate": "2022-09-01",
  "cloudCover": 20
}
```

### 3. Start Processing Job
**POST** `/sentinel/process`

**Request Body:**
```json
{
  "searchParams": {
    "latitude": -6.0,
    "longitude": -53.0,
    "startDate": "2022-06-01",
    "endDate": "2022-09-01",
    "cloudCover": 20
  },
  "maxImages": 10
}
```

### 4. Get Job Status
**GET** `/sentinel/status/{jobId}`

Returns the current status and progress of a processing job.

### 5. Analyze Region
**POST** `/sentinel/analyze-region`

Performs immediate deforestation analysis for a specific region.

### 6. Trigger Step Functions
**POST** `/sentinel/step-functions/trigger`

Starts the AWS Step Functions workflow for comprehensive analysis.

---

## 🎨 Frontend Integration Examples

### React/Next.js Example
```typescript
// API client setup
const API_BASE_URL = 'http://localhost:3000';

// Get dashboard statistics
export const getDashboardStats = async () => {
  const response = await fetch(`${API_BASE_URL}/dashboard/stats`);
  return response.json();
};

// Get regions
export const getRegions = async (status?: string) => {
  const url = new URL(`${API_BASE_URL}/dashboard/regions`);
  if (status) url.searchParams.append('status', status);
  
  const response = await fetch(url.toString());
  return response.json();
};

// Create new region
export const createRegion = async (regionData: CreateRegionDto) => {
  const response = await fetch(`${API_BASE_URL}/dashboard/regions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regionData),
  });
  return response.json();
};
```

### Vue.js Example
```typescript
// Composable for dashboard data
export const useDashboard = () => {
  const stats = ref(null);
  const regions = ref([]);
  const alerts = ref([]);

  const fetchStats = async () => {
    const response = await $fetch('/dashboard/stats');
    stats.value = response;
  };

  const fetchRegions = async () => {
    const response = await $fetch('/dashboard/regions');
    regions.value = response;
  };

  const fetchAlerts = async () => {
    const response = await $fetch('/dashboard/alerts');
    alerts.value = response;
  };

  return {
    stats,
    regions,
    alerts,
    fetchStats,
    fetchRegions,
    fetchAlerts,
  };
};
```

### Angular Example
```typescript
// Service for API calls
@Injectable()
export class ForestShieldService {
  private baseUrl = 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  getDashboardStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.baseUrl}/dashboard/stats`);
  }

  getRegions(status?: string): Observable<Region[]> {
    const params = status ? { status } : {};
    return this.http.get<Region[]>(`${this.baseUrl}/dashboard/regions`, { params });
  }

  createRegion(region: CreateRegionDto): Observable<Region> {
    return this.http.post<Region>(`${this.baseUrl}/dashboard/regions`, region);
  }
}
```

---

## 📈 Dashboard UI Components

### Key Metrics Cards
```typescript
interface DashboardMetrics {
  totalRegions: number;
  activeAlerts: number;
  avgDeforestation: number;
  imagesProcessed: number;
  activeJobs: number;
  lastUpdate: string;
}
```

### Regional Map Visualization
```typescript
interface MapRegion {
  id: string;
  name: string;
  coordinates: [number, number];
  deforestationLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  lastAnalysis: string;
}
```

### Alert Management Interface
```typescript
interface Alert {
  id: string;
  regionName: string;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}
```

### Historical Trend Charts
```typescript
interface TrendData {
  date: string;
  vegetationPercentage: number;
  deforestationPercentage: number;
  ndviValue: number;
}
```

---

## 🚀 Getting Started

1. **Start the API server:**
   ```bash
   pnpm run start:dev
   ```

2. **Access Swagger UI:**
   Open `http://localhost:3000/api/docs`

3. **Test endpoints:**
   Use the interactive Swagger UI or your preferred HTTP client

4. **Build your dashboard:**
   Use the provided endpoints to create your custom deforestation monitoring interface

---

## 📚 Additional Resources

- **Swagger UI**: `http://localhost:3000/api/docs` - Interactive API documentation
- **Health Check**: `http://localhost:3000/sentinel/health` - Service status
- **CORS**: Configured for common development origins
- **Validation**: All endpoints include request validation and error handling

---

## 🔍 Error Handling

All endpoints return structured error responses:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `404` - Not Found
- `500` - Internal Server Error

---

**Built for Production** - These endpoints are designed to handle real AWS integrations and can scale with your monitoring needs. 🌱 