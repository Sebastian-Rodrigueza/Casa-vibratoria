@echo off
echo Instalando dependencias (Flask)...
pip install -r backend\requirements_gdb.txt

echo.
echo Iniciando servidor SinergIA (Mapa.html + soporte File Geodatabase .gdb)...
python servidor_mapa_gdb.py

pause
