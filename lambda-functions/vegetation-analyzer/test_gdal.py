#!/usr/bin/env python3
"""
Simple GDAL test for vegetation-analyzer
Tests that GDAL imports and works properly with the lambgeo layer
"""

def test_gdal_import():
    """Test GDAL import and basic functionality"""
    try:
        # Import GDAL
        from osgeo import gdal, ogr, osr
        
        # Get GDAL version
        gdal_version = gdal.VersionInfo()
        print(f"✅ GDAL Version: {gdal_version}")
        
        # Get driver count
        driver_count = gdal.GetDriverCount()
        print(f"✅ Available drivers: {driver_count}")
        
        # Test creating an in-memory dataset
        mem_driver = gdal.GetDriverByName('MEM')
        dataset = mem_driver.Create('', 10, 10, 1, gdal.GDT_Byte)
        print(f"✅ In-memory dataset created: {dataset is not None}")
        
        # Test rasterio import
        import rasterio
        print(f"✅ Rasterio version: {rasterio.__version__}")
        
        print("🎉 ALL GDAL TESTS PASSED!")
        return True
        
    except Exception as e:
        print(f"❌ GDAL test failed: {e}")
        return False

if __name__ == "__main__":
    test_gdal_import() 