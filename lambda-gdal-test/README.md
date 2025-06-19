# GDAL Lambda Test Function

This is a ridiculously simple AWS Lambda function to test if the lambgeo GDAL layer works.

## What it does
- Imports GDAL from the lambgeo layer
- Checks GDAL version and available drivers
- Creates a simple in-memory raster
- Returns success/failure status

## Files
- `handler.py` - The Lambda function handler
- `requirements.txt` - Empty (relies on lambgeo layer)

## Deployment
Use the AWS CLI commands provided below to deploy this function.

The function uses the public lambgeo layer:
- Layer ARN: `arn:aws:lambda:{REGION}:524387336408:layer:gdal38:{VERSION}`
- Required environment variables:
  - `GDAL_DATA=/opt/share/gdal`
  - `PROJ_LIB=/opt/share/proj`

## Expected Response
If successful, you should see:
```json
{
  "message": "HOLY SHIT IT WORKS! 🎉",
  "gdal_version": "3080300",
  "driver_count": 200,
  "test_status": "PASSED - Layer is working perfectly!"
}
``` 