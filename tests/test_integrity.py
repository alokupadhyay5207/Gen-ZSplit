"""Legacy SQLite integrity tests are disabled during the MongoDB migration.
Equivalent MongoDB validation tests must be added before this suite is considered complete.
"""
import unittest

raise unittest.SkipTest("SQLite-specific integrity tests are not applicable to the MongoDB backend yet")
