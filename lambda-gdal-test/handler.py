import json
import os

def lambda_handler(event, context):
    """
    Simple AWS Lambda function to test GDAL layer functionality.
    This is a ridiculously simple test to see if the lambgeo layer works.
    """
    
    try:
        # Try to import GDAL
        from osgeo import gdal, ogr, osr
        
        # Get GDAL version
        gdal_version = gdal.VersionInfo()
        
        # Get available drivers count
        driver_count = gdal.GetDriverCount()
        driver_list = []
        for i in range(min(5, driver_count)):  # Just get first 5 drivers
            driver = gdal.GetDriver(i)
            driver_list.append(driver.GetDescription())
        
        # Check environment variables
        gdal_data = os.environ.get('GDAL_DATA', 'NOT SET')
        proj_lib = os.environ.get('PROJ_LIB', 'NOT SET')
        
        # Try to create a simple in-memory raster (super basic test)
        mem_driver = gdal.GetDriverByName('MEM')
        dataset = mem_driver.Create('', 10, 10, 1, gdal.GDT_Byte)
        
        success_message = "HOLY SHIT IT WORKS! 🎉"
        
        response = {
            'statusCode': 200,
            'body': json.dumps({
                'message': success_message,
                'gdal_version': gdal_version,
                'driver_count': driver_count,
                'sample_drivers': driver_list,
                'environment': {
                    'GDAL_DATA': gdal_data,
                    'PROJ_LIB': proj_lib
                },
                'memory_dataset_created': dataset is not None,
                'test_status': 'PASSED - Layer is working perfectly!'
            })
        }
        
        # Clean up
        dataset = None
        
        return response
        
    except ImportError as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'GDAL import failed',
                'message': str(e),
                'test_status': 'FAILED - Layer not working'
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Unexpected error',
                'message': str(e),
                'test_status': 'FAILED - Something went wrong'
            })
        } 