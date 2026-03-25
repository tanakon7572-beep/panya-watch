FROM php:8.2-apache

RUN a2enmod rewrite

# บังคับ Apache ใช้ port 8080 + bind IPv4
RUN sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf \
 && sed -i 's/:80/:8080/' /etc/apache2/sites-available/000-default.conf \
 && sed -i 's/Listen 8080/Listen 0.0.0.0:8080/' /etc/apache2/ports.conf

COPY . /var/www/html/
RUN chown -R www-data:www-data /var/www/html

EXPOSE 8080

CMD ["apache2-foreground"]
