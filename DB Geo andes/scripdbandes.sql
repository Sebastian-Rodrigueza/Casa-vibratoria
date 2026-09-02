CREATE DATABASE geoDbandes;
USE geoDbandes;




CREATE TABLE categorias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE
);


INSERT INTO categorias (nombre) VALUES ("Cobertura del suelo y usos");

CREATE TABLE datasets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    categoria_id INT,
    nombre_dataset VARCHAR(255),
    entidad_responsable VARCHAR(255),
    descripcion TEXT,
    departamento VARCHAR(100),
    municipio VARCHAR(100),
    formato VARCHAR(50),
    url_fuente TEXT,
    url_descarga TEXT,
    fecha_actualizacion DATE,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

ALTER TABLE datasets
ADD COLUMN arcgis_id VARCHAR(64) UNIQUE;