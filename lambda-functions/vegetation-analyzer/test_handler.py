import json
import numpy

def lambda_handler(event, context):
    """
    A simple test handler to verify the numpy library from the GeoLambda layer.
    """
    print(f"Successfully imported numpy version: {numpy.__version__}")
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Numpy imported successfully!',
            'numpy_version': numpy.__version__
        })
    } 